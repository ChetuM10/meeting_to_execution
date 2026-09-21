import { WorkflowState } from '../state';
import {
    extractFromTranscript,
    SchemaValidationError,
    LLMProviderError,
} from '../../extraction/llm';

//Node: 3 - Calls LLM to extract decisions, action items, and open questions from the transcript.
export async function extractStructuredInfoNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    try {
        const result = await extractFromTranscript(state.transcript);

        console.log(
            `[extract_structured_info] Extracted ${result.decisions.length} decisions, ` +
            `${result.action_items.length} action items, ` +
            `${result.open_questions.length} open questions.`
        );

        return {
            draft_extraction: result,
            validation_error: null,
            error: null,
        };
    } catch (err: any) {
        if (err instanceof SchemaValidationError) {
            // Zod validation failed — the retry loop can attempt a repair
            console.warn(
                '[extract_structured_info] Schema validation failed:',
                err.zodError.message
            );
            return {
                draft_extraction: null,
                validation_error: err.zodError.message,
            };
        }

        // LLM provider failure (network, rate-limit, empty response, bad JSON)
        console.error('[extract_structured_info] LLM error:', err.message);
        return {
            error: `LLM extraction failed: ${err.message}`,
        };
    }
}
