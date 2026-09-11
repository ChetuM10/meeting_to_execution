import { GoogleGenAI, Type } from "@google/genai";
import { z } from 'zod';
import { HistoricalContext } from './history';
import { ExtractionResult } from "./schema";

// previous open que resolved
export interface ResolvedQuestion {
    open_question_id: string; //old id of open_quesiton row
    resolved_by_content: string; //cont3ent of the new decision which resoleved it
}

// zod schema validation
const ResolutionSchema = z.object({
    resolved: z.array(
        z.object({
            open_question_id: z.string().uuid(),
            resolved_by_content: z.string().min(1),
        })
    ),
});

const RESOLUTION_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        resolved: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    open_question_id: { type: Type.STRING },
                    resolved_by_content: { type: Type.STRING },
                },
                required: ['open_question_id', 'resolved_by_content'],
            },
        },
    },
    required: ['resolved'],
}


// compares newly extracted decisions against historically open questions
export async function resolveOpenQuestions(
    extraction: ExtractionResult,
    history: HistoricalContext,
    apiKey: string
): Promise<ResolvedQuestion[]> {
    if (history.open_questions.length === 0) {
        return [];
    }

    if (extraction.decisions.length === 0) {
        return [];
    }
    const openQlist = history.open_questions
        .map(q => `- Id: ${q.id}\n Question: "${q.question}"`)
        .join('\n');

    const decisionList = extraction.decisions
        .map(d => `- "${d.content}" (confidence: ${d.confidence})`)
        .join('\n');

    const PROMPT = `
    You are reviewing a project's meeting history.

    PREVIOUSLY OPEN QUESTIONS (from past meetings, not yet resolved):
    ${openQlist}

    NEW DECISIONS made in the latest meeting:
    ${decisionList}

    Task: For each open question that is clearly answered by one of the new     decision, return a match.
    Only match if there is a clear. unambiguous resolution - do not guess.
    If no questions are resolved, return an empty "resolved" array.
    `.trim();

    const ai = new GoogleGenAI({ apiKey });

    let raw: unknown;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            config: {
                temperature: 0,
                responseMimeType: 'application/json',
                responseSchema: RESOLUTION_RESPONSE_SCHEMA,
            },
            contents: PROMPT,
        });

        if (!response.text) {
            return [];
        }
        raw = JSON.parse(response.text);
    } catch (err) {
        console.error('resolvedOpenQuestions: Gemini call or JSON parse failed.', err);
        return [];
    }

    const parsed = ResolutionSchema.safeParse(raw);
    if (!parsed.success) {
        console.error('resolveOpenQuestions: schema validation failed:', parsed.error);
        return [];
    }

    const validIds = new Set(history.open_questions.map(q => q.id));
    return parsed.data.resolved.filter(r => validIds.has(r.open_question_id));
}