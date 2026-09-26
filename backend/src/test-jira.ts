import dotenv from 'dotenv';
import { createJiraIssue, verifyJiraIssue, JiraCredentials } from './integrations/jira/client';
import { generateIdempotencyKey } from './utils/idempotency';

dotenv.config();

async function runJiraTest() {
    console.log('🚀 ____ Starting End-to-End Jira Integration Test ____\n');

    const rawUrl = process.env.JIRA_BASE_URL || '';
    const email = process.env.JIRA_EMAIL || '';
    const apiToken = process.env.JIRA_API_TOKEN || '';
    const projectKey = process.env.JIRA_PROJECT_KEY || 'M2E';

    const cleanDomain = rawUrl
        .replace(/^https?:\/\//, '')
        .replace(/\.atlassian\.net.*$/, '')
        .trim();

    if (!cleanDomain || !email || !apiToken) {
        console.error('❌ Error: JIRA credentials must be set in backend/.env');
        process.exit(1);
    }

    const credentials: JiraCredentials = {
        domain: cleanDomain,
        email: email.trim(),
        apiToken: apiToken.trim(),
    };

    console.log(`Target Jira Site: https://${credentials.domain}.atlassian.net`);
    console.log(`Authenticating as: ${credentials.email}`);
    console.log(`Project Key: ${projectKey}\n`);

    try {
        // Sample Action Items from a meeting
        const actionItems = [
            { task: 'Setup PostgreSQL Database', owner: 'Chetan', deadline: '2026-10-01' },
            { task: 'Setup PostgreSQL Database', owner: 'Chetan', deadline: '2026-10-01' }, // ⚠️ DUPLICATE of Task 1
            { task: 'Build API Endpoints', owner: 'Manjunath', deadline: '2026-10-05' },      // Task 2
        ];

        const mockRunId = 'workflow-run-real-test-01';
        const executedKeys = new Set<string>(); // Simulates execution_logs table in database

        console.log(`Processing ${actionItems.length} action items...\n`);

        for (const item of actionItems) {
            // 1. Generate Idempotency Key
            const idempotencyKey = generateIdempotencyKey(mockRunId, 'create_jira_issue', item);

            // 2. Check if already executed (Idempotency Defense)
            if (executedKeys.has(idempotencyKey)) {
                console.log(`⚠️ DUPLICATE DETECTED: Task "${item.task}" (Owner: ${item.owner}) was already executed.`);
                console.log(`   ⏭️ Skipping Jira call for this duplicate item!\n`);
                continue;
            }

            // 3. Create real ticket in Jira
            console.log(`--- Creating Jira Issue for: "${item.task}" ---`);
            const issue = await createJiraIssue(credentials, {
                projectKey,
                summary: item.task,
                description: `Owner: ${item.owner}\nDeadline: ${item.deadline}\n\nCreated automatically from meeting action items.`,
                issueType: 'Task',
            });

            executedKeys.add(idempotencyKey); // Record execution

            console.log(`✅ Success! Created Issue: ${issue.key}`);
            console.log(`🔗 URL: https://${credentials.domain}.atlassian.net/browse/${issue.key}`);

            // 4. Verify in Jira
            const verification = await verifyJiraIssue(credentials, issue.key);
            console.log(`🔍 Verified in Jira: Status "${verification.status}"\n`);
        }

        console.log('🎉 ALL ACTION ITEMS PROCESSED & VERIFIED!');
    } catch (err: any) {
        console.error('\n❌ Test failed with error:', err.message);
    }
}

runJiraTest();
