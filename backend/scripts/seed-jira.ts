import dotenv from 'dotenv';
import { query } from '../src/db/connection';
import { encrypt, decrypt } from '../src/utils/crypto';

dotenv.config();

async function seedJiraCredentials() {
    // 1. Guard against accidental run in production
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
        console.error('Refusing to run seed script in production without ALLOW_SEED=true');
        process.exit(1);
    }

    console.log('Encrypting and saving Jira credentials to Postgres...\n');

    // 2. Allow passing workspace ID via CLI arg or env, with fallback
    const workspaceId = process.argv[2] || process.env.SEED_WORKSPACE_ID || '4ee051e4-d2dc-4c9f-9ee7-2a0fd7181ba3';
    const rawUrl = process.env.JIRA_BASE_URL || '';
    const email = process.env.JIRA_EMAIL || '';
    const apiToken = process.env.JIRA_API_TOKEN || '';

    const cleanDomain = rawUrl
        .replace(/^https?:\/\//, '')
        .replace(/\.atlassian\.net.*$/, '')
        .trim();

    if (!cleanDomain || !email || !apiToken) {
        console.error('Error: Missing credentials in .env (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN required)');
        process.exit(1);
    }

    // Encrypt credentials
    const payload = JSON.stringify({
        domain: cleanDomain,
        email: email.trim(),
        apiToken: apiToken.trim(),
    });

    const encryptedToken = encrypt(payload);

    // Round-trip safety check before saving
    const check = JSON.parse(decrypt(encryptedToken));
    console.log('Round-trip check:', check.domain === cleanDomain ? '✅ matches' : '❌ MISMATCH');

    if (check.domain !== cleanDomain) {
        console.error('Encryption/decryption mismatch! Aborting database insert.');
        process.exit(1);
    }

    // Delete any old connection for this workspace & insert fresh
    await query(
        `DELETE FROM integration_connections WHERE workspace_id = $1 AND provider = 'jira'`,
        [workspaceId]
    );

    const result = await query(
        `INSERT INTO integration_connections (workspace_id, provider, encrypted_token)
         VALUES ($1, 'jira', $2)
         RETURNING id, workspace_id, provider, encrypted_token`,
        [workspaceId, encryptedToken]
    );

    const saved = result.rows[0];
    console.log('\nSuccessfully stored in Postgres!');
    console.log(`   Workspace ID:    ${saved.workspace_id}`);
    console.log(`   Provider:        ${saved.provider}`);
    console.log(`   Encrypted Token: ${saved.encrypted_token.substring(0, 35)}... (iv:authTag:ciphertext)\n`);

    process.exit(0);
}

seedJiraCredentials().catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
