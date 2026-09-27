import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { initCheckpointer } from './workflow/checkpointer';
import { runWorkflow, resumeWorkflow } from './workflow/graph';

dotenv.config();

async function main() {
    console.log(' -------- Starting the Workflow Test -------- \n');

    try {
        // 1 - initialize database checkpointer
        console.log('[Setup] Initializing checkpointer...');
        await initCheckpointer();

        // 2 - read the transcript
        const transcriptPath = path.join(__dirname, '../sample_transcript.txt');
        if (!fs.existsSync(transcriptPath)) {
            throw new Error(`Please create ${transcriptPath} and paste your transcript.`);
        }

        const transcript = fs.readFileSync(transcriptPath, 'utf-8');

        // 3 - real project for test
        const { query } = await import('./db/connection');
        const projectId = '84e87b92-5791-4414-af67-3ff22b47bdee';
        const meetingId = randomUUID();
        const workflowId = randomUUID();

        await query(
            `INSERT INTO meetings (id, project_id, raw_transcript, transcript_hash)
             VALUES ($1, $2, $3, $4)`,
            [meetingId, projectId, transcript, randomUUID()]
        );

        await query(
            `INSERT INTO workflow_runs (id, meeting_id, status)
             VALUES ($1, $2, 'processing')`,
            [workflowId, meetingId]
        );

        console.log(`\n[Setup] Real Postgres chain created:`);
        console.log(`Project ID:     ${projectId}`);
        console.log(`Meeting ID:     ${meetingId}`);
        console.log(`Workflow ID:    ${workflowId}`);

        // 4 - run workflow
        console.log(`\n[Phase 1] Starting workflow run...`);
        const initialResult = await runWorkflow(transcript, projectId, workflowId);

        console.log('\n-------- Workflow paused for Human Review --------');
        console.log('Proposed Actions generated:');
        console.log(JSON.stringify(initialResult.proposed_action, null, 2));

        console.log('\nAmbiguity Flags:');
        console.log(JSON.stringify(initialResult.ambiguity_flags, null, 2));

        // 5 - human review
        console.log('\n[Phase 2] Simulating human "Approve"...');

        const finalResult = await resumeWorkflow(workflowId, 'approved');

        console.log('\n-------- Workflow Completed --------');
        console.log('Execution results (Jira Tickets):');
        console.log(JSON.stringify(finalResult.execution_result, null, 2));

        console.log('\nTest Passed!');
    } catch (error) {
        console.error('\n Workflow test failed:', error);
    } finally {
        // forcefully exit to close DB pool connection
        process.exit(0);
    }
}

main();