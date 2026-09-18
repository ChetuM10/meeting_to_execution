import { randomUUID } from "crypto";
import { WorkflowState, proposedAction } from "../state";

const MAX_PROPOSED_ACTIONS = 10;
const MIN_CONFIDENCE_THRESHOLD = 0.7;

// Node:9 - generates candidate Jira action items from validated action items
export async function generateProposedActionsNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    if (!state.validated_extraction) {
        console.warn(
            `[generate_proposed_actions] No validated extraction found, skipping.`
        );
        return { proposed_action: [] };
    }

    const actionItems = state.validated_extraction.action_items;

    // filter confin=dent actions and cap at MAX_PROPOSED_ACTIONS
    const proposed: proposedAction[] = actionItems
        .filter((item) => item.confidence >= MIN_CONFIDENCE_THRESHOLD)
        .slice(0, MAX_PROPOSED_ACTIONS)
        .map((item) => ({
            id: randomUUID(),
            task: item.task,
            owner: item.owner ?? 'Unassigned',
            deadline: item.deadline ?? 'None',
            confidence: String(item.confidence),
            issue_type: 'Task',
        }));

    console.log(
        `[generate_proposed_action] Generated ${proposed.length} proposed action(s)` +
        `from ${actionItems.length} extracted item(s).`
    );

    return {
        proposed_action: proposed
    };
}