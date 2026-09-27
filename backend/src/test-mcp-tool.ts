import dotenv from 'dotenv';
import { JiraCredentials } from './integrations/jira/client';
import {
    executeCreateJiraIssueTool,
    executeVerifyJiraIssueTool,
    createJiraIssueToolDef,
    verifyJiraIssueToolDef,
} from './integrations/jira/mcp_tool';

dotenv.config();

async function runMcpToolTest() {
    console.log('Starting Standalone MCP Jira Tool Tests');

    // 1. Load credentials from .env
    const rawUrl = process.env.JIRA_BASE_URL || '';
    const email = process.env.JIRA_EMAIL || '';
    const apiToken = process.env.JIRA_API_TOKEN || '';
    const projectKey = process.env.JIRA_PROJECT_KEY || 'M2E';

    const cleanDomain = rawUrl
        .replace(/^https?:\/\//, '')
        .replace(/\.atlassian\.net.*$/, '')
        .trim();

    if (!cleanDomain || !email || !apiToken) {
        console.error('Credentials missing in .env (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN required)');
        process.exit(1);
    }

    const credentials: JiraCredentials = {
        domain: cleanDomain,
        email: email.trim(),
        apiToken: apiToken.trim(),
    };

    console.log('Tool Definitions:');
    console.log(` - Tool 1: ${createJiraIssueToolDef.name}`);
    console.log(` - Tool 2: ${verifyJiraIssueToolDef.name}\n`);

    let createdTicketKey = '';

    // T1: Call executeCreateJiraIssueTool with valid arguments
    console.log('--- Test 1: executeCreateJiraIssueTool with VALID args ---');
    const validCreateRes = await executeCreateJiraIssueTool(credentials, {
        projectKey,
        summary: `MCP Tool Test: Automated Task ${Date.now()}`,
        description: 'Created via executeCreateJiraIssueTool standalone MCP wrapper.',
        issueType: 'Task',
    });

    console.log('Response shape:', JSON.stringify(validCreateRes, null, 2));

    if (validCreateRes.isError) {
        throw new Error(`Test 1 Failed: Expected successful creation, got error: ${validCreateRes.content[0]?.text}`);
    }

    const parsedCreate = JSON.parse(validCreateRes.content[0].text);
    if (!parsedCreate.issueKey || !parsedCreate.issueId) {
        throw new Error(`Test 1 Failed: Missing issueKey or issueId in response: ${validCreateRes.content[0].text}`);
    }
    createdTicketKey = parsedCreate.issueKey;
    console.log(`Test 1 Passed! Created live ticket: ${createdTicketKey}\n`);

    // T2: Call executeCreateJiraIssueTool with missing required argument (no summary)
    console.log('--- Test 2: executeCreateJiraIssueTool with MISSING summary ---');
    const invalidCreateRes = await executeCreateJiraIssueTool(credentials, {
        projectKey,
        // summary is intentionally omitted
    });

    console.log('Response shape:', JSON.stringify(invalidCreateRes, null, 2));

    if (!invalidCreateRes.isError) {
        throw new Error('Test 2 Failed: Expected isError: true for missing summary, but got success.');
    }
    console.log('Test 2 Passed! Handled missing argument gracefully with isError: true\n');

    // T3: Call executeVerifyJiraIssueTool on the created ticket
    console.log(`--- Test 3: executeVerifyJiraIssueTool on REAL ticket (${createdTicketKey}) ---`);
    const verifyRealRes = await executeVerifyJiraIssueTool(credentials, {
        issueKey: createdTicketKey,
    });

    console.log('Response shape:', JSON.stringify(verifyRealRes, null, 2));

    if (verifyRealRes.isError) {
        throw new Error(`Test 3 Failed: Verification threw an error: ${verifyRealRes.content[0]?.text}`);
    }

    const parsedVerifyReal = JSON.parse(verifyRealRes.content[0].text);
    if (parsedVerifyReal.exists !== true || !parsedVerifyReal.status) {
        throw new Error(`Test 3 Failed: Expected exists: true with a status, got: ${verifyRealRes.content[0].text}`);
    }
    console.log(`Test 3 Passed! Ticket ${createdTicketKey} exists with status: "${parsedVerifyReal.status}"\n`);

    // T4: Call executeVerifyJiraIssueTool on nonexistent ticket
    const fakeKey = `${projectKey}-999999`;
    console.log(`--- Test 4: executeVerifyJiraIssueTool on NONEXISTENT ticket (${fakeKey}) ---`);
    const verifyFakeRes = await executeVerifyJiraIssueTool(credentials, {
        issueKey: fakeKey,
    });

    console.log('Response shape:', JSON.stringify(verifyFakeRes, null, 2));

    if (verifyFakeRes.isError) {
        throw new Error(`Test 4 Failed: Expected graceful response with exists: false, but got isError: true`);
    }

    const parsedVerifyFake = JSON.parse(verifyFakeRes.content[0].text);
    if (parsedVerifyFake.exists !== false) {
        throw new Error(`Test 4 Failed: Expected exists: false, got: ${verifyFakeRes.content[0].text}`);
    }
    console.log('Test 4 Passed! Correctly returned exists: false without throwing.\n');

    console.log('ALL MCP TOOL WRAPPER TESTS PASSED SUCCESSFULLY!');
}

runMcpToolTest().catch((err) => {
    console.error('\nMCP Tool Test Suite Failed:', err);
    process.exit(1);
});
