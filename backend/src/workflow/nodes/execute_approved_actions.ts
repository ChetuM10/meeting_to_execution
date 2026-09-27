import { WorkflowState, ExecutionResult } from "../state";
import { query } from '../../db/connection';
import { createJiraIssue, JiraCredentials } from "../../integrations/jira/client";
import { generateIdempotencyKey } from "../../utils/idempotency";
import { decrypt } from '../../utils/crypto';

// this reads Jira credentials for the workspace that owns this project
async function getJiraCredentials(projectId: string): Promise<JiraCredentials |
    null> {
    const result = await query(
        `SELECT ic.encrypted_token, ic.expires_at
        FROM integration_connections ic
        JOIN workspaces w ON ic.workspace_id = w.id
        JOIN projects p ON p.workspace_id = w.id
        WHERE p.id = $1 AND ic.provider = 'jira'`,
        [projectId]
    );

    if (!result.rowCount || result.rowCount === 0) return null;

    const row = result.rows[0];

    // check if token expired or not
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        console.warn('[execute] Jira token has expired.');
        return null;
    }

    const tokenData = JSON.parse(decrypt(row.encrypted_token));

    return {
        domain: tokenData.domain,
        email: tokenData.email,
        apiToken: tokenData.apiToken,
    };
}


// Node:11 - Executes approved actions
export async function executeApprovedActionsNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    if (state.review_status !== 'approved') {
        console.log(
            `[execute_approved_actions] Review status is '${state.review_status}', skipping execution.`
        );
        return {
            execution_result: []
        };
    }

    // use edited actions if human reviewer modified them; else use proposed
    const actionsToExecute = state.edited_actions ?? state.proposed_action;

    console.log(
        `[execute_approved_actions] Executing ${actionsToExecute.length} action(s)...`
    );

    // get Jira credentials
    const credentials = await getJiraCredentials(state.project_id);

    if (!credentials) {
        console.error('[execute] No Jira credentials found or token expired.');
        return {
            execution_result: actionsToExecute.map(action => ({
                action_id: action.id,
                status: 'failure' as const,
                error: 'No Jira connection configured or token expired.',
            })),
        };
    }

    // this determines default Jira project key from projects table
    let defaultProjectKey = process.env.JIRA_PROJECT_KEY || 'M2E';
    try {
        const projRow = await query(
            `SELECT jira_project_key FROM projects WHERE id = $1`,
            [state.project_id]
        );
        if (projRow.rows[0]?.jira_project_key) {
            defaultProjectKey = projRow.rows[0].jira_project_key;
        }
    } catch (e) {
        // fallback to defaultProjectKey
    }

    // Checkcs if workflow run exists in DB so we can safely persist proposed_actions and execution_logs
    let hasWfRun = false;
    try {
        const wfCheck = await query('SELECT id FROM workflow_runs WHERE id = $1', [state.workflow_id]);
        hasWfRun = Boolean(wfCheck.rowCount && wfCheck.rowCount > 0);
    } catch (err) {
        hasWfRun = false;
    }

    const results: ExecutionResult[] = [];

    for (const action of actionsToExecute) {
        const projectKey = action.jira_project_key || defaultProjectKey;

        // build payload for idempotency
        const payload = {
            summary: action.task,
            owner: action.owner,
            deadline: action.deadline,
            projectKey
        };

        const idempotencyKey = generateIdempotencyKey(
            state.workflow_id,
            'create_jira_issue',
            payload
        );

        // thi ensures proposed_actions row exists in DB before execution_logs insertion
        // avoids FK violation
        if (hasWfRun) {
            try {
                await query(
                    `INSERT INTO proposed_actions (id, workflow_run_id, type, payload_json, status)
                     VALUES ($1, $2, 'create_jira_issue', $3, 'approved')
                     ON CONFLICT (id) DO UPDATE SET status = 'approved'`,
                    [action.id, state.workflow_id, JSON.stringify(action)]
                );
            } catch (dbErr) {
                console.warn(`[execute] Could not persist proposed_action ${action.id}:`, dbErr);
            }
        }

        // check if already executed
        try {
            const existing = await query(
                `SELECT external_id, status FROM execution_logs
                WHERE idempotency_key = $1`,
                [idempotencyKey]
            );

            if (existing.rowCount && existing.rowCount > 0) {
                console.log(
                    `[execute] Action ${action.id} already executed. Skipping.`
                );
                results.push({
                    action_id: action.id,
                    status: existing.rows[0].status === 'success' ? 'success' : 'failure',
                    jira_issue_key: existing.rows[0].external_id ?? undefined,
                });
                continue;
            }
        } catch (err) {
            console.error(`[execute] Idempotency check failed for ${action.id}:`, err);
        }

        // call Jira API
        try {
            const jiraResult = await createJiraIssue(credentials, {
                projectKey,
                summary: action.task,
                description: `Owner: ${action.owner ?? 'unassigned'}\nDeadline: ${action.deadline ?? 'None'}\n\nCreated from meeting action item.`,
                issueType: action.issue_type ?? 'Task',
            });

            console.log(
                `[execute] Created Jira ticket ${jiraResult.key} for: '${action.task}'`
            );

            // log success
            if (hasWfRun) {
                await query(
                    `INSERT INTO execution_logs (proposed_action_id, external_id, idempotency_key, status)
                    VALUES ($1, $2, $3, 'success')`,
                    [action.id, jiraResult.key, idempotencyKey]
                );
                await query(
                    `UPDATE proposed_actions SET status = 'executed' WHERE id = $1`,
                    [action.id]
                );
            }

            results.push({
                action_id: action.id,
                status: 'success',
                jira_issue_key: jiraResult.key,
            });
        } catch (err: any) {
            console.error(`[execute] Jira call failed for ${action.id}:`, err.message);

            // Log failure
            if (hasWfRun) {
                await query(
                    `INSERT INTO execution_logs (proposed_action_id, external_id, idempotency_key, status, error_message)
                     VALUES ($1, NULL, $2, 'failed', $3)`,
                    [action.id, idempotencyKey, err.message]
                );
            }
            results.push({
                action_id: action.id,
                status: 'failure',
                error: err.message,
            });
        }
    }
    return { execution_result: results };
}