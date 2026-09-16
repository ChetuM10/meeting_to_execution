import { ReinforcementTuningThinkingLevel } from "@google/genai";
import { WorkflowState } from "../state";
const MIN_TRANSCRIPT_LENGTH = 50;

// validates if the transcript contains meaningful content
export async function validateTranscript(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    const trimmed = state.transcript?.trim() ?? '';

    if (trimmed.length === 0) {
        console.warn('[validate_transcript] Empty transcript received.');
        return { error: 'Transcript is empty.' };
    }

    if (trimmed.length < MIN_TRANSCRIPT_LENGTH) {
        console.warn(
            `[validate_transcript] Transcript too short (${trimmed.length} chars, minimum ${MIN_TRANSCRIPT_LENGTH}).`
        );
        return {
            error: `Transcript too short: ${trimmed.length} characters (minimum ${MIN_TRANSCRIPT_LENGTH}).`
        };
    }

    console.log(
        `[validate_transcript] Transcript OK (${trimmed.length} chars).`
    );
    return { error: null };
}