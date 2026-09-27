import { randomUUID } from "crypto";
import { WorkflowState, proposedAction } from "../state";
import { query } from "../../db/connection";

const MAX_PROPOSED_ACTIONS = 10;
const MIN_CONFIDENCE_THRESHOLD = 0.7;

// Node:9 - generates candidate Jira action items from validated action items
export async function generateProposedActionsNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    if (!state.validated_extraction) {
        console.warn(
            `[generate_proposed_actions] No validated extraction found, skipping.`
        );
        return { proposed_action: [] };
    }

    const actionItems = state.validated_extraction.action_items;

    // filter confident actions and cap at MAX_PROPOSED_ACTIONS
    const proposed: proposedAction[] = actionItems
        .filter((item) => item.confidence >= MIN_CONFIDENCE_THRESHOLD)
        .slice(0, MAX_PROPOSED_ACTIONS)
        .map((item) => ({
            id: randomUUID(),
            task: item.task,
            owner: item.owner ?? 'Unassigned',
            deadline: item.deadline ?? 'None',
            confidence: item.confidence,
            issue_type: 'Task',
        }));

    // this saves proposed actions to DB so the review screen can display them
    try {
        const wfCheck = await query('SELECT id FROM workflow_runs WHERE id = $1', [state.workflow_id]);
        if (wfCheck.rowCount && wfCheck.rowCount > 0) {
            for (const item of proposed) {
                await query(
                    `INSERT INTO proposed_actions (id, workflow_run_id, type, payload_json, status)
                     VALUES ($1, $2, 'create_jira_issue', $3, 'pending')
                     ON CONFLICT (id) DO NOTHING`,
                    [item.id, state.workflow_id, JSON.stringify(item)]
                );
            }
        }
    } catch (err: any) {
        console.warn('[generate_proposed_actions] DB insert error:', err.message);
    }

    console.log(
        `[generate_proposed_action] Generated ${proposed.length} proposed action(s)` +
        `from ${actionItems.length} extracted item(s).`
    );

    return {
        proposed_action: proposed
    };
}