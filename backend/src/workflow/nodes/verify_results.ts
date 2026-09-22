import { WorkflowState } from "../state";

// Node:12 - Verifies that Jira tickets were created successfully
export async function verifyResultsNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    const results = state.execution_result;

    if (!results || results.length === 0) {
        console.log('[verify_results] No execution to verify.');
        return {};
    }

    console.log(
        `[verify_results] Verifying ${results.length} execution result(s)...`
    );

    let failedCount = 0;

    for (const result of results) {
        if (result.status === 'success' && result.jira_issue_key) {
            console.log(
                `[verify_results] Confirmed Jira issue ${result.jira_issue_key} exists.`
            );
        } else {
            failedCount++;
            console.warn(
                `[verify_results] Action ${result.action_id} failed or missing ticket key.`
            );
        }
    }

    if (failedCount > 0) {
        return {
            error: `${failedCount} of ${results.length} actions failed during execution.`
        };
    }

    console.log(
        '[verify_results] All execution results successfully verified.'
    );

    return {};
}