import OpenAI from "openai";
import { zodResponseFormat } from 'openai/helpers/zod';
import { ExtractionSchema, ExtractionResult } from './schema';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are an expert AI meeting assistant and project manager. Analyze the
meeting transcript and extract structured information. If nothing
qualifies for a category, return an empty array — never invent items to
fill the schema.

1. DECISIONS
   - A decision is an explicit agreement or commitment made by
     participants — not a proposal, suggestion, or idea left unresolved.
   - source_quote: the exact verbatim sentence(s) from the transcript.
     Do not paraphrase or summarize.
   - confidence (0-1): 1.0 = explicit and unambiguous ("we've decided to
     ship X"); lower for decisions that are implied or only partially
     confirmed.

2. ACTION ITEMS
   - A concrete task someone committed to doing — not a hypothetical
     ("we could maybe...") or a topic merely discussed.
   - source_quote: exact verbatim sentence(s) the task was drawn from.
   - owner: the person named as responsible, else null.
   - deadline: an explicit date/timeframe as stated verbatim (do not
     resolve relative dates like "next Friday" yourself unless the
     meeting date is provided in context); else null.
   - confidence (0-1), same calibration as above.
   - ambiguity_flags: any of [missing_owner, vague_deadline, vague_scope]
     — only these values, omit the field entirely if none apply.

3. OPEN QUESTIONS
   - A question raised that had no answer by the end of the transcript.
   - source_quote: exact verbatim sentence(s).
   - status: "open".
`;

export async function extractFromTranscript(transcript: string):
    Promise<ExtractionResult> {
    if (!transcript || transcript.trim().length === 0) {
        throw new Error('Transcript text cannot be empty.');
    }

    try {
        const completion = await openai.beta.chat.completions.parse({
            model: 'gpt-4o-mini',
            temperature: 0,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Analyze the following meeting transcript:\n\n${transcript}` },
            ],
            response_format: zodResponseFormat(ExtractionSchema, 'extraction_result'),
        });
        const choice = completion.choices[0];

        if (choice?.message?.refusal) {
            throw new Error(`LLM Refused Request: ${choice.message.refusal}`);
        }
        const parsed = choice?.message?.parsed;
        if (!parsed) {
            throw new Error('LLM failed to return structured extraction result.');
        }
        return parsed;
    } catch (error: any) {

        console.error('Error during transcript extraction:', error?.message || error);
        throw new Error(`Extraction failed: ${error?.message || 'Unknown error'}`);
    }
}
