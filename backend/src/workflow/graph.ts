import { StateGraph, END, START } from '@langchain/langgraph';
import { WorkflowAnnotation, WorkflowState } from './state';
import { checkpointer } from './checkpointer';
import { query } from '../db/connection';

import { validateTranscript } from './nodes/validate_transcript';
import { fetchHistoricalContextNode } from './nodes/fetch_historical_context';
import { extractStructuredInfoNode } from './nodes/extract_structured_info';
import { validateSchemaNode } from './nodes/validate_schema';
import { repairOrRetryNode } from './nodes/repair_retry';
import { flagForManualEntryNode } from './nodes/flag_for_manual_entry';
import { compareAgainstHistoryNode } from './nodes/compare_against_history';
import { detectAmbiguityNode } from './nodes/detect_ambiguity';
import { generateProposedActionsNode } from './nodes/generate_proposed_actions';
import { humanReviewNode } from './nodes/human_review';
import { executeApprovedActionsNode } from './nodes/execute_approved_actions';
import { verifyResultsNode } from './nodes/verify_results';
import { storeFinalStateNode } from './nodes/store_final_state';

const MAX_RETRIES = 2;

function routeAfterTranscriptValidation(state: WorkflowState): string {
    if (state.error) return END;
    return 'fetch_historical_context';
}

function routeAfterValidation(state: WorkflowState): string {
    if (!state.validation_error) return 'compare_against_history';
    if (state.retry_count < MAX_RETRIES) return 'repair_or_retry';
    return 'flag_for_manual_entry';
}

function routeAfterExtraction(state: WorkflowState): string {
    if (state.error) return END;
    return 'validate_schema';
}

function routeAfterReview(state: WorkflowState): string {
    if (state.review_status === 'approved') return 'execute_approved_actions';
    return END;
}

const workflow = new StateGraph(WorkflowAnnotation)

    .addNode('validate_transcript', validateTranscript)
    .addNode('fetch_historical_context', fetchHistoricalContextNode)
    .addNode('extract_structured_info', extractStructuredInfoNode)
    .addNode('validate_schema', validateSchemaNode)
    .addNode('repair_or_retry', repairOrRetryNode)
    .addNode('flag_for_manual_entry', flagForManualEntryNode)
    .addNode('compare_against_history', compareAgainstHistoryNode)
    .addNode('detect_ambiguity', detectAmbiguityNode)
    .addNode('generate_proposed_actions', generateProposedActionsNode)
    .addNode('human_review', humanReviewNode)
    .addNode('execute_approved_actions', executeApprovedActionsNode)
    .addNode('verify_results', verifyResultsNode)
    .addNode('store_final_state', storeFinalStateNode)

    // Start - validate transcript
    .addEdge(START, 'validate_transcript')
    .addConditionalEdges('validate_transcript', routeAfterTranscriptValidation)
    .addEdge('fetch_historical_context', 'extract_structured_info')
    .addConditionalEdges('extract_structured_info', routeAfterExtraction)
    .addConditionalEdges('validate_schema', routeAfterValidation)
    .addEdge('repair_or_retry', 'extract_structured_info')
    .addEdge('flag_for_manual_entry', 'human_review')
    .addEdge('compare_against_history', 'detect_ambiguity')
    .addEdge('detect_ambiguity', 'generate_proposed_actions')
    .addEdge('generate_proposed_actions', 'human_review')
    .addConditionalEdges('human_review', routeAfterReview)
    .addEdge('execute_approved_actions', 'verify_results')
    .addEdge('verify_results', 'store_final_state')
    .addEdge('store_final_state', END);

export const graph = workflow.compile({
    checkpointer,
    interruptBefore: ['human_review'],
});

// reads the current graph state from the checkpointer
export async function getWorkflowState(
    workflowId: string
): Promise<WorkflowState | null> {
    try {
        const state = await graph.getState({
            configurable: { thread_id: workflowId },
        });

        if (!state || !state.values) return null;
        return state.values as WorkflowState;
    } catch (err) {
        console.error(`[graph] Failed to read state for ${workflowId}:`, err);
        return null;
    }
}

// updates workflow_runs.state in PostgreSQL so that frontend the it 
// repeatedly checks for update instead of waiting the backend to push an update(polling)

async function updateWorkflowStatus(
    workflowId: string,
    status: string
): Promise<void> {
    await query(
        `UPDATE workflow_runs SET status = $1, updated_at = NOW() where id = $2`,
        [status, workflowId]
    );
}

export async function runWorkflow(
    transcript: string,
    projectId: string,
    workflowId: string
) {
    const threadId = workflowId; // workflow_run UUID as thread ID

    try {
        const result = await graph.invoke(
            {
                transcript,
                project_id: projectId,
                workflow_id: workflowId,
            },
            {
                configurable: { thread_id: threadId },
            }
        );

        if (result.error) {
            await updateWorkflowStatus(workflowId, 'failed');
        } else {
            await updateWorkflowStatus(workflowId, 'pending_review');
        }

        return result;
    } catch (err) {
        console.error(`[graph] Workflow ${workflowId} failed:`, err);
        await updateWorkflowStatus(workflowId, 'failed');
        throw err;
    }
}

// resumes paused workflow after review
export async function resumeWorkflow(
    workflowId: string,
    decision: 'approved' | 'rejected',
    editedActions?: any[]
) {
    const { Command } = await import('@langchain/langgraph');

    try {
        const result = await graph.invoke(
            new Command({
                resume: {
                    decision,
                    edited_actions: editedActions ?? null,
                },
            }),
            {
                configurable: { thread_id: workflowId },
            }
        );

        if (decision === 'rejected') {
            await updateWorkflowStatus(workflowId, 'rejected');
        } else {
            await updateWorkflowStatus(workflowId, 'completed');
        }

        return result;
    } catch (err) {
        console.error(`[graph] Resume failed for ${workflowId}:`, err);
        await updateWorkflowStatus(workflowId, 'failed');
        throw err;
    }
}