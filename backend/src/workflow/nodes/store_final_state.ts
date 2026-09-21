import { WorkflowState } from "../state";
import { query } from "../../db/connection";

//this is a helper function to format date or fallback to null for Postgres DATE column
function parseDateOrNull(val: string | null | undefined): string | null {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// Node:13 - Persists extraction results and updates workflow status in database
export async function storeFinalStateNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {

    if (!state.validated_extraction) {
        console.warn(
            `[store_final_state] No validated extraction to store.`
        );
        return {}
    }

    try {
        const wfCheck = await query(
            'SELECT meeting_id FROM workflow_runs WHERE id = $1',
            [state.workflow_id]
        );

        if (wfCheck.rowCount === 0) {
            console.warn(
                `[stoe_final_state] Workflow run ${state.workflow_id} not found in DB. Skipping DB persistence (offlice test mode).`
            );
            return {};
        }

        const meetingId = wfCheck.rows[0].meeting_id;
        const extraction = state.validated_extraction;

        // 1 - Insert decisions
        for (const d of extraction.decisions) {
            await query(
                `INSERT INTO decisions
                (project_id, meeting_id, workflow_run_id, content, confidence, source_quote)
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    state.project_id,
                    meetingId,
                    state.workflow_id,
                    d.content,
                    d.confidence,
                    d.source_quote,
                ]
            );
        }

        // 2- Insert action items
        for (const a of extraction.action_items) {
            await query(
                `INSERT INTO action_items
                (project_id, meeting_id, workflow_run_id, task, owner, deadline, confidence, ambiguity_flags)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    state.project_id,
                    meetingId,
                    state.workflow_id,
                    a.task,
                    a.owner,
                    parseDateOrNull(a.deadline),
                    a.confidence,
                    a.ambiguity_flags || [],
                ]
            );
        }

        // 3 - insert new open questions
        for (const q of extraction.open_questions) {
            await query(
                `INSERT INTO open_questions
                (project_id, meeting_id, workflow_run_id, question, status)
                VALUES ($1, $2, $3, $4, 'open')`,
                [state.project_id, meetingId, state.workflow_id, q.question]
            );
        }

        // 4. Mark resolved questions from past meetings
        if (state.resolved_question && state.resolved_question.length > 0) {
            for (const rq of state.resolved_question) {
                await query(
                    `UPDATE open_questions 
                    SET status = 'resolved' 
                    WHERE id = $1`,
                    [rq.open_question_id]
                );
            }
        }
        // 5. Update workflow_run to completed with state snapshot
        await query(
            `UPDATE workflow_runs 
            SET status = 'completed', 
                state_json = $2, 
                updated_at = NOW() 
            WHERE id = $1`,
            [state.workflow_id, JSON.stringify(state)]
        );
        console.log(
            `[store_final_state] Successfully persisted extraction for workflow ${state.workflow_id}.`
        );
    } catch (err: any) {
        console.error('[store_final_state] Database persistence error:', err.message);
        return {
            error: `Failed to persist final state: ${err.message}`,
        };
    }

    return {};
}