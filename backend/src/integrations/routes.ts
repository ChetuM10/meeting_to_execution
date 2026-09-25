import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/connection';
import { encrypt } from '../utils/crypto';
import { hasOwn } from 'openai/core';
import { Connection } from 'pg';

const router = Router();

router.use(authenticateToken);

// POST /api/integrations/jira/connect
// Store or Update Jira credentials
router.post('/jira/connect', async (req: AuthenticatedRequest, res: Response):
    Promise<void> => {
    const { workspaceId, domain, email, apiToken, expiresAt } = req.body;
    const userId = req.user!.userId;

    if (!workspaceId || !domain || !email || !apiToken) {
        res.status(400).json({
            error: 'Missing required fields: workspaceId, domain, email and apiToken are required.'
        });
        return;
    }

    try {
        // verify workspace owner
        const workspaceCheck = await query(
            `SELECT id from wokspaces WHERE id = $1 AND owner_id = $2`,
            [workspaceId, userId]
        );

        if (!workspaceCheck.rowCount || workspaceCheck.rowCount === 0) {
            res.status(404).json({
                error: 'Workspace not found or unauthorized.'
            });
            return;
        }

        // clean domain
        const cleanDomain = domain
            .replace(/^https?:\/\//, '')
            .replace(/\.atlassian\.net.*$/, '')
            .trim();


        // encrypt payload
        const payloadToEncrypt = JSON.stringify({
            domain: cleanDomain,
            email: email.trim(),
            apiToken: apiToken.trim(),
        });

        const encryptedToken = encrypt(payloadToEncrypt);

        // remove existing connection and insert a fresh one
        await query(
            `DELETE FROM integration_connections
            WHERE workspace_id = $1 AND provider = 'jira'`,
            [workspaceId]
        );

        const insertResult = await query(
            `INSERT INTO integration_connections (workspace_id, provider, encrypted_token, expires_at)
            VALUES ($1, 'jira', $2, $3)
            RETURNING id, workspace_id, provider, created_at, expires_at`,
            [workspaceId, encryptedToken, expiresAt ?? null]
        );

        const saved = insertResult.rows[0];

        // response _ without exposing credentials
        res.status(201).json({
            message: 'Jira integration connected successfullt.',
            Connection: {
                id: saved.id,
                workspaceId: saved.workspaceId,
                provider: saved.provider,
                created_at: saved.created_at,
                expires_at: saved.expires_at,
            }
        });
    } catch (err: any) {
        console.error(`[integrations] Failed to connect Jira:`, err.message);
        res.status(500).json({
            error: 'Failed to save Jira integration.'
        });
    }
});