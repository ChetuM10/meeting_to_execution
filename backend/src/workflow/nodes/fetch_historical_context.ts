import { WorkflowState } from "../state";
import { fetchHistoricalContext } from "../../extraction/history";

// Node: 2 - loads open questions and active decisions from earlier meetings
export async function fetchHistoricalContext(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    try {
        const history = await fetchHistoricalContext(state.project_id);

        console.log(
            `[fetch_historical_context] Loaded
            ${history.open_questions.length} open questions,
            ${history.decisions.length} decisions for project
            ${state.project_id}.`
        );

        return { historical_context: history };
    } catch (err: any) {
        console.error('[fetch_historical_context] Failed:', err.message);
        return {
            error: `Failed to fetch historical context: ${err.message}`,
        };
    }
}