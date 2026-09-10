import { query } from '../db/connection';

export interface HistoricalOpenQuestion {
    id: string;
    question: string;
    meeting_id: string;
    created_at: string;
}

export interface HistoricalDecision {
    id: string;
    content: string;
    confidence: number;
    source_quote: string;
    meeting_id: string;
    created_at: string;
}

export interface HistoricalContext {
    open_questions: HistoricalOpenQuestion[];
    decisions: HistoricalDecision[];
}


export async function fetchHistoricalContext(
    project_id: string
): Promise<HistoricalContext> {
    const [oqResult, decResult] = await Promise.all([
        query<HistoricalOpenQuestion>(
            `SELECT id, question, meeting_id, created_at
            FROM open_questions
            WHERE project_id = $1
            AND status = 'open
            ORDER BY created_at ASC`,
            [project_id]
        ),
        query<HistoricalDecision>(
            `SELECT id, content, confidence, source_quote, meeting_idm created_at
            FROM decisions
            WHERE project_id = $1
            AND status = 'active
            ORDER BY created_at ASC`,
            [project_id]
        ),
    ]);

    return {
        open_questions: oqResult.rows,
        decisions: decResult.rows,
    };
}