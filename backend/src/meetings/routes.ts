import { Router, Response } from 'express';
import { createHash } from 'crypto';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/connection';
import { initCheckpointer } from '../workflow/checkpointer';
import { runWorkflow } from '../workflow/graph';

const router = Router();

router.use(authenticateToken);

// POST /api/meetings 
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { project_id, transcript } = req.body;
    const userId = req.user!.userId;

    // validate input
    if (!project_id || !transcript || transcript.trim() === '') {
        res.status(400).json({
            error: 'project_id and transcript are required.'
        });
        return;
    }

    try {
        // verify if the project belongs to this user's workspace
        const projectCheck = await query(
            `SELECT p.id FROM projects p
            JOIN workspaces w ON p.workspace_id = w.id
            WHERE p.id = $1 AND w.owner_id = $2`,
            [project_id, userId]
        );

        if (!projectCheck.rowCount || projectCheck.rowCount === 0) {
            res.status(404).json({
                error: 'Project not found.'
            });
            return;
        }

        // 3 - hash transcript for dupplicate deletion
        const transcriptHash = createHash('sha256')
            .update(transcript.trim())
            .digest('hex');

        // 4 - insert meeting
        let meetingId: string;
        try {
            const meetingResult = await query(
                `INSERT INTO meetings (project_id, raw_tanscript, transcript_hash)
                VALUES ($1, $2, $3)
                RETURNING id`,
                [project_id, transcript.trim(), transcriptHash]
            );
            meetingId = meetingResult.rows[0].id;
        } catch (err: any) {
            if (err.code === '23505') {
                res.status(409).json({
                    error: 'This transcript has already been submitted for this project.'
                });
                return;
            }
            throw err;
        }

        // 5 - create workflow_run row with status = 'processing'
        const workflowResult = await query(
            `INSERT INTO workflow_runs (meeting_id, status)
            VALUES ($1, 'processing')
            RETURNING id`,
            [meetingId]
        );
        const workflowRunId = workflowResult.rows[0].id;

        // 6 - run the workflow in the background
        // no await - we want the APi to respond immediately
        initCheckpointer()
            .then(() => runWorkflow(transcript.trim(), project_id, workflowRunId))
            .catch((err) => {
                console.error(`[meetings] Background workflow dailed for ${workflowRunId}:`, err);
            });

        // respond immediately
        res.status(201).json({
            meeting_id: meetingId,
            workflow_run_id: workflowRunId,
            status: 'processing',
        });
    } catch (err) {
        console.error('[meetings] Submit transcript error:', err);
        res.status(500).json({
            error: 'Internal server error.'
        });
    }
});

export default router;