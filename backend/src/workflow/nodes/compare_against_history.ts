import { WorkflowState } from "../state";
import { resolveOpenQuestions } from "../../extraction/resolver";

// Node:7 - compares newly extracted decisions against historical open questions
export async function compareAgainstHistoryNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    if (!state.validated_extraction || !state.historical_context) {
        console.log(
            `[compare_against_history] Missing extraction or historical context, skipping comparison.`
        );
        return { resolved_question: [] };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn(
            `[compare_against_history] GEMINI_API_KEY missing, skipping history resolution.`
        );
        return { resolved_question: [] };
    }

    try {
        const resolved = await resolveOpenQuestions(
            state.validated_extraction,
            state.historical_context,
            apiKey
        );
        console.log(
            `[compare_against_history] Found ${resolved.length} resolved historical questions.`
        );
        return {
            resolved_question: resolved,
        };
    } catch (err: any) {
        console.log(
            `[compare_against_history] Error comparing against history:`, err.message
        );

        return { resolved_question: [] };
    }
}