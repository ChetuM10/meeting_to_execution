import { Router, Response } from "express";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth";
import { query } from '../db/connection';

const router = Router();

router.use(authenticateToken);

// POST api/projects
router.post('/', async (req: AuthenticatedRequest, res: Response):
    Promise<void> => {
    const { name, description, jira_project_key } = req.body;
    const userId = req.user!.userId;

    // validate input
    if (!name || name.trim() === '') {
        res.status(400).json({ error: 'Project name is required.' });
        return;
    }

    try {
        // check if this user already has worksapce
        const workspaceResult = await query(
            'SELECT id FROM workspaces WHERE owner_id = $1 LIMIT 1',
            [userId]
        );

        let workspaceId: string;

        // if no workspace exists then auto-create default one
        if (!workspaceResult.rowCount || workspaceResult.rowCount === 0) {
            const newWorkspace = await query(
                `INSERT INTO workspaces (name, owner_id)
                VALUES ($1, $2)
                RETURNING id`,
                ['My Workspace', userId]
            );
            workspaceId = newWorkspace.rows[0].id;
        } else {
            workspaceId = workspaceResult.rows[0].id;
        }

        // create the project
        const result = await query(
            `INSERT INTO projects (workspace_id, name, description, jira_project_key, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, name, description, jira_project_key, created_at`,
            [workspaceId, name.trim(), description || null, jira_project_key || null, userId]
        );

        const project = result.rows[0];

        // return created projects
        res.status(201).json({
            message: 'Project created successfully.',
            project,
        });
    } catch (err) {
        console.error('Create project error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});