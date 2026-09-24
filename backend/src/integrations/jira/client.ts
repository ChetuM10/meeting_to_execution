export interface JiraCredentials {
    domain: string;
    email: string;
    apiToken: string;   // decrypted API token
}

export interface CreateIssueParams {
    projectKey: string;
    summary: string;
    description: string;
    issueType: string;
}

export interface JiraIssueResult {
    key: string;
    id: string;
    self: string;   // API URL to create issue
}

// this creates a Jira issue and returns the ticket key
export async function createJiraIssue(
    credentials: JiraCredentials,
    params: CreateIssueParams,
): Promise<JiraIssueResult> {
    const baseUrl = `https://${credentials.domain}.atlassian.net`;
    const url = `${baseUrl}/rest/api/3/issue`;

    // auth: base64
    const authHeader = 'Basic ' + Buffer.from(
        `${credentials.email}:${credentials.apiToken}`
    ).toString('base64');

    const body = {
        fields: {
            project: { key: params.projectKey },
            summary: params.summary,
            description: {
                type: 'doc',
                version: 1,
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: params.description },
                        ],
                    },
                ],
            },
            issuetype: { name: params.issueType },
        },
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `Jira API error (${response.status}): ${errorBody}`
        );
    }

    const data = await response.json() as JiraIssueResult;

    return {
        key: data.key,
        id: data.id,
        self: data.self,
    };
}