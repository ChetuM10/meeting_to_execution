import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/connection';
import { getWorkflowState, graph, resumeWorkflow } from './graph';

const router = Router();

router.use(authenticateToken);

// GET /api/workflow_runs_id
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const userId = req.user!.userId;

    try {
        // verify the workflow belongs to this user's workspace
        const result = await query(
            `SELECT wr.id, wr.status, wr.created_at, wr.updated_at
            FROM workflow_runs wr
            JOIN meetings m ON wr.meeting_id = m.id
            JOIN projects p ON m.project_id = p.id
            JOIN workspaces w ON p.workspace_id = w.id
            WHERE wr.id = $1 AND w.owner_id = $2`,
            [id, userId]
        );

        if (!result.rowCount || result.rowCount === 0) {
            res.status(404).json({
                error: 'Workflow run not found.'
            });
            return;
        }
        const workflowRun = result.rows[0];

        // if pending_review, return the graph's paused state
        // so the frontend can render the review screen
        if (workflowRun.status === 'pending_review') {
            const graphState = await getWorkflowState(id);

            res.json({
                ...workflowRun,
                extraction: graphState?.validated_extraction ?? null,
                proposed_actions: graphState?.proposed_action ?? [],
                ambiguity_flags: graphState?.ambiguity_flags ?? [],
                resolved_questions: graphState?.resolved_question ?? [],
            });
            return;
        }

        // if completed, return execution results
        if (workflowRun.status === 'completed') {
            const graphState = await getWorkflowState(id);

            res.json({
                extraction: graphState?.validated_extraction ?? null,
                execution_results: graphState?.execution_result ?? [],
            });
            return;
        }

        // for processing/failed/rejected - jsut return status
        res.json(workflowRun);
    } catch (err) {
        console.error('[workflow_runs] Poll error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// POST /api/workflow-runs/:id/approve ___ after it, resume workflow
router.post('/:id/approve', async (req: AuthenticatedRequest, res: Response):
    Promise<void> => {
    const { id } = req.params;
    const { edited_actions } = req.body;
    const userId = req.user!.userId;

    try {
        // check for ownership
        const ownerCheck = await query(
            `SELECT wr.id FROM workflow_runs wr
            JOIN meetings m ON wr.meeting_id = m.id
            JOIN projects p ON m.project_id = p.id
            JOIN workspaces w ON p.workspace_id = w.id
            WHERE wr.id = $1 AND w.owner_id = $2`,
            [id, userId]
        );

        if (!ownerCheck.rowCount || ownerCheck.rowCount === 0) {
            res.status(404).json({ error: 'Workflow run not found.' });
            return;
        }

        const flipResult = await query(
            `UPDATE workflow_runs
            SET status = 'executing', updated_at = NOW()
            WHERE id = $1 AND status = 'pending_review'`,
            [id]
        );

        if (!flipResult.rowCount || flipResult.rowCount === 0) {
            res.status(409).json({
                error: 'Workflow is not in pending_review state. It may have already been approved.',
            });
            return;
        }

        // resume the graph with 'approved'
        resumeWorkflow(id, 'approved', edited_actions ?? undefined)
            .catch((err) => {
                console.error(`[workflow-runs] Resume after approve failed for ${id}:`, err);
            });

        res.json({ status: 'executing' });
    } catch (err) {
        console.error('[workflow-runs] Approve error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// POST /api/workflow-runs/:id/reject — reject, no external action
router.post('/:id/reject', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    try {
        // verify ownership
        const ownerCheck = await query(
            `SELECT wr.id FROM workflow_runs wr
             JOIN meetings m ON wr.meeting_id = m.id
             JOIN projects p ON m.project_id = p.id
             JOIN workspaces w ON p.workspace_id = w.id
             WHERE wr.id = $1 AND w.owner_id = $2`,
            [id, userId]
        );
        if (!ownerCheck.rowCount || ownerCheck.rowCount === 0) {
            res.status(404).json({ error: 'Workflow run not found.' });
            return;
        }
        // flip to rejected (same atomic guard)
        const flipResult = await query(
            `UPDATE workflow_runs
             SET status = 'rejected', updated_at = NOW()
             WHERE id = $1 AND status = 'pending_review'`,
            [id]
        );
        if (!flipResult.rowCount || flipResult.rowCount === 0) {
            res.status(409).json({
                error: 'Workflow is not in pending_review state.',
            });
            return;
        }
        // resume graph with rejection so it exits cleanly
        resumeWorkflow(id, 'rejected')
            .catch((err) => {
                console.error(`[workflow-runs] Resume after reject failed for ${id}:`, err);
            });
        res.json({ status: 'rejected' });
    } catch (err) {
        console.error('[workflow-runs] Reject error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;