import { WorkflowState } from "../state";

const MAX_RETRIES = 2;

// Node:5 - increments the retry count and appends the validation error to the 
//          transcript for repair

export async function repairOrRetryNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    const newRetryCount = state.retry_count + 1;

    console.log(
        `[repair_or_retry] Retry ${newRetryCount}/${MAX_RETRIES}. Error: ${state.validation_error}`
    );

    // append repair instructions to transcript
    const reapairedTranscript =
        state.transcript +
        `\n\n --- SYSTEM REPAIR NOTE ---\n` +
        `Your previous extraction failed schema validation: \n` +
        `${state.validation_error}\n` +
        `Please re-extract the information and fix the issues listed above.\n` +
        `--- END REPAIR NOTE ---`;

    return {
        retry_count: newRetryCount,
        transcript: reapairedTranscript,
        draft_extraction: null,
        validation_error: null,
    };
}