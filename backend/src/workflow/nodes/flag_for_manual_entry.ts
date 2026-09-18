import { WorkflowState } from "../state";

// Node:6 - flags the workflow for manual entry when retries are exhausted
export async function flagForManualEntryNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    console.warn(
        `[flag_for_manual_entry] Retries exhausted (${state.retry_count}).` +
        `Last error: ${state.validation_error}. Flagging for manual entry.`
    );

    return {
        needs_manual_entry: true,
        error: `Schema repair failed after ${state.retry_count} retries.` +
            `Last validation error: ${state.validation_error}.` +
            `Manual entry required.`,
    };
}