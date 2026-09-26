import dotenv from 'dotenv';
import { executeApprovedActionsNode } from './workflow/nodes/execute_approved_actions';
import { WorkflowState } from './workflow/state';
import { query } from './db/connection';
import { randomUUID } from 'crypto';

dotenv.config();

async function runExecutionNodeTest() {
    console.log('--- Testing executeApprovedActionsNode with Real Postgres & Jira ---\n');

    const projectId = '84e87b92-5791-4414-af67-3ff22b47bdee'; // my project ID

    // 1. a dummy meeting, workflow_run, and proposed_action so foreign keys exist
    const meetingId = randomUUID();
    const workflowId = randomUUID();
    const actionId = randomUUID();

    await query(
        `INSERT INTO meetings (id, project_id, raw_transcript, transcript_hash)
         VALUES ($1, $2, 'dummy transcript', $3)`,
        [meetingId, projectId, randomUUID()]
    );

    await query(
        `INSERT INTO workflow_runs (id, meeting_id, status)
         VALUES ($1, $2, 'executing')`,
        [workflowId, meetingId]
    );

    await query(
        `INSERT INTO proposed_actions (id, workflow_run_id, type, payload_json, status)
         VALUES ($1, $2, 'create_jira_issue', '{"task":"Deploy Redis Caching Layer"}', 'approved')`,
        [actionId, workflowId]
    );

    console.log(` Seeded test records in Postgres:`);
    console.log(`   Meeting ID:         ${meetingId}`);
    console.log(`   Workflow Run ID:    ${workflowId}`);
    console.log(`   Proposed Action ID: ${actionId}\n`);

    // 2. Simulated approved state from human review
    const mockState: Partial<WorkflowState> = {
        project_id: projectId,
        workflow_id: workflowId,
        review_status: 'approved',
        proposed_action: [
            {
                id: actionId,
                task: 'Deploy Redis Caching Layer',
                owner: 'Chetan',
                deadline: '2026-10-10',
                jira_project_key: 'M2E',
                issue_type: 'Task',
                confidence: '0.95',
            },
        ],
    };

    console.log('--- Step 1: Running executeApprovedActionsNode (First Run) ---');
    const result1 = await executeApprovedActionsNode(mockState as WorkflowState);
    console.log('\nExecution Result 1:', JSON.stringify(result1, null, 2));

    // Verify it was logged to Postgres execution_logs
    const dbLogs = await query(
        `SELECT external_id, idempotency_key, status FROM execution_logs WHERE proposed_action_id = $1`,
        [actionId]
    );

    console.log('\n Postgres execution_logs row:');
    console.log(dbLogs.rows);

    console.log('\n--- Step 2: Running executeApprovedActionsNode AGAIN (Idempotency Test) ---');
    const result2 = await executeApprovedActionsNode(mockState as WorkflowState);
    console.log('\nExecution Result 2 (Postgres skips Jira call and returns existing):');
    console.log(JSON.stringify(result2, null, 2));

    process.exit(0);
}

runExecutionNodeTest().catch(err => {
    console.error(' Test failed:', err);
    process.exit(1);
});
