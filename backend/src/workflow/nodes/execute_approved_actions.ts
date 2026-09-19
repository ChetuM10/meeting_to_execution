import { WorkflowState, ExecutionResult } from "../state";

// Node:11 - Executes approved actions
export async function executeApprovedActionsNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    if (state.review_status !== 'approved') {
        console.log(
            `[execute_aproved_actions] Review status is '${state.review_status}', skipping execution.`
        );
        return {
            execution_result: []
        };
    }

    // use edited actions if human reviewer modified them; else use proposed
    const actionsToExecute = state.edited_actions ?? state.proposed_action;

    console.log(
        `[execute_aproved_actions] Executing ${actionsToExecute.length} action(s)...`
    );

    // Simulate Jira ticket creation
    const results: ExecutionResult[] = actionsToExecute.map((action, index) => {
        const mockTicketKey = `MOCK-${100 + index + 1}`;
        console.log(
            `{execute_approved_actions} Created Jira ticket ${mockTicketKey} for:
            '${action.task}' (Owner: ${action.owner})`
        );

        return {
            action_id: action.id,
            status: 'success',
            jira_project_key: mockTicketKey,
        };
    });

    return {
        execution_result: results,
    };
}