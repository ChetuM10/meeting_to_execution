import { interrupt } from "@langchain/langgraph";
import { WorkflowState } from "../state";

// Node:10 - Pauses the graph fpr human review using LangGraph interrupt
export async function humanReviewNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    console.log(
        `[human_review] Interrupting for human review.` +
        `${state.proposed_action.length} proposed action(s),` +
        `${state.ambiguity_flags} ambiguity flag(s).`
    );

    // interrupt() pauses the graph and wait for the user
    // it resumes when Command({ resume: { decisions, edited_actions }}) is sent

    const reviewResult = interrupt({
        proposed_actions: state.proposed_action,
        ambiguity_flags: state.ambiguity_flags,
        validated_extraction: state.validated_extraction,
    });

    const decision = reviewResult.decision as 'approved' | 'rejected';
    const editedActions = reviewResult.edited_actions ?? null;

    console.log(
        `[human_review] Resumed with decision: ${decision}`
    );
    return {
        review_status: decision,
        edited_actions: editedActions,
    };
}