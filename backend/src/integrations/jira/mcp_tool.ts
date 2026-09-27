import {
    createJiraIssue,
    verifyJiraIssue,
    JiraCredentials,
} from './client';

export interface McpContentItem {
    type: 'text';
    text: string;
}

export interface McpToolResponse {
    content: McpContentItem[];
    isError?: boolean;
}

//create_jira_issue

export const createJiraIssueToolDef = {
    name: 'create_jira_issue',
    description: 'Create a new issue/ticket in Jira Cloud under a specified project key.',
    inputSchema: {
        type: 'object',
        properties: {
            projectKey: {
                type: 'string',
                description: 'The Jira project key (e.g., "M2E").',
            },
            summary: {
                type: 'string',
                description: 'The summary/title of the Jira issue.',
            },
            description: {
                type: 'string',
                description: 'The issue description detailing context or task deliverables.',
            },
            issueType: {
                type: 'string',
                description: 'Issue type name (e.g., "Task", "Bug", "Story"). Defaults to "Task".',
            },
        },
        required: ['projectKey', 'summary'],
    },
};

// verify_jira_issue
export const verifyJiraIssueToolDef = {
    name: 'verify_jira_issue',
    description: 'Verify if a Jira issue exists and return its current status.',
    inputSchema: {
        type: 'object',
        properties: {
            issueKey: {
                type: 'string',
                description: 'The Jira issue key to verify (e.g., "M2E-12").',
            },
        },
        required: ['issueKey'],
    },
};


//Executes the create_jira_issue tool with validation and structured error response.

export async function executeCreateJiraIssueTool(
    credentials: JiraCredentials,
    args: any
): Promise<McpToolResponse> {
    // 1. Argument validation
    if (!args || typeof args !== 'object') {
        return {
            isError: true,
            content: [{ type: 'text', text: 'Invalid arguments: expected an object with projectKey and summary.' }],
        };
    }

    if (!args.projectKey || typeof args.projectKey !== 'string' || !args.projectKey.trim()) {
        return {
            isError: true,
            content: [{ type: 'text', text: 'Validation error: "projectKey" is required and must be a non-empty string.' }],
        };
    }

    if (!args.summary || typeof args.summary !== 'string' || !args.summary.trim()) {
        return {
            isError: true,
            content: [{ type: 'text', text: 'Validation error: "summary" is required and must be a non-empty string.' }],
        };
    }

    // 2. Call Jira client with safe error handling
    try {
        const result = await createJiraIssue(credentials, {
            projectKey: args.projectKey.trim(),
            summary: args.summary.trim(),
            description: typeof args.description === 'string' ? args.description : '',
            issueType: typeof args.issueType === 'string' && args.issueType.trim() ? args.issueType.trim() : 'Task',
        });

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        issueKey: result.key,
                        issueId: result.id,
                        issueUrl: result.self,
                    }, null, 2),
                },
            ],
        };
    } catch (err: any) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Jira issue creation failed: ${err.message || String(err)}`,
                },
            ],
        };
    }
}


//Executes the verify_jira_issue tool with validation and structured error response.

export async function executeVerifyJiraIssueTool(
    credentials: JiraCredentials,
    args: any
): Promise<McpToolResponse> {
    // 1. Argument validation
    if (!args || typeof args !== 'object') {
        return {
            isError: true,
            content: [{ type: 'text', text: 'Invalid arguments: expected an object with issueKey.' }],
        };
    }

    if (!args.issueKey || typeof args.issueKey !== 'string' || !args.issueKey.trim()) {
        return {
            isError: true,
            content: [{ type: 'text', text: 'Validation error: "issueKey" is required and must be a non-empty string.' }],
        };
    }

    // 2. Call Jira client with safe error handling
    try {
        const result = await verifyJiraIssue(credentials, args.issueKey.trim());

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        exists: result.exists,
                        status: result.status ?? null,
                    }, null, 2),
                },
            ],
        };
    } catch (err: any) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Jira issue verification failed: ${err.message || String(err)}`,
                },
            ],
        };
    }
}
