import { GoogleGenAI, Type } from '@google/genai';
import { ZodError } from 'zod';
import { ExtractionSchema, ExtractionResult } from './schema';

let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
    if (!aiClient) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not defined in environment variables.');
        }
        aiClient = new GoogleGenAI({ apiKey });
    }
    return aiClient;
}

// Behavioral guidance only — field names/types are enforced server-side via responseSchema below.
const SYSTEM_PROMPT = `
You are an expert AI meeting assistant and project manager. Analyze the meeting transcript and extract structured information.

Guidelines:
- DECISIONS: explicit agreements or commitments only — not proposals or unresolved ideas.
  source_quote must be exact verbatim text from the transcript.
  confidence: 1.0 = explicit and unambiguous; lower for implied or partially confirmed.
- ACTION ITEMS: concrete tasks someone committed to — not hypotheticals or topics discussed.
  owner = person responsible or null. deadline = verbatim date/timeframe or null.
  ambiguity_flags: use "missing_owner", "vague_deadline", or "vague_scope" as applicable; empty array if none.
- OPEN QUESTIONS: questions raised with no answer by end of transcript. status must be "open".
- If nothing qualifies for a category, return an empty array — never invent items.
`;

// Gemini native responseSchema — enforced server-side, not prompt-hoped.
const RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        decisions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    content: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    source_quote: { type: Type.STRING },
                },
                required: ['content', 'confidence', 'source_quote'],
            },
        },
        action_items: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    task: { type: Type.STRING },
                    owner: { type: Type.STRING, nullable: true },
                    deadline: { type: Type.STRING, nullable: true },
                    confidence: { type: Type.NUMBER },
                    ambiguity_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['task', 'owner', 'deadline', 'confidence', 'ambiguity_flags'],
            },
        },
        open_questions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    question: { type: Type.STRING },
                    status: { type: Type.STRING },
                },
                required: ['question', 'status'],
            },
        },
    },
    required: ['decisions', 'action_items', 'open_questions'],
};

// Distinct error types so the caller (LangGraph node) can branch on failure kind.
export class SchemaValidationError extends Error {
    constructor(public zodError: ZodError) {
        super('Extraction result failed schema validation.');
        this.name = 'SchemaValidationError';
    }
}

export class LLMProviderError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LLMProviderError';
    }
}

export async function extractFromTranscript(transcript: string): Promise<ExtractionResult> {
    if (!transcript || transcript.trim().length === 0) {
        throw new Error('Transcript text cannot be empty.');
    }

    const ai = getGeminiClient();

    let responseText: string | undefined;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            config: {
                systemInstruction: SYSTEM_PROMPT,
                temperature: 0,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA,
            },
            contents: `Analyze the following meeting transcript:\n\n${transcript}`,
        });
        responseText = response.text;
    } catch (error: any) {
        // Network/rate-limit/provider-side failure — retry-with-backoff territory.
        throw new LLMProviderError(error?.message || 'Gemini API call failed.');
    }

    if (!responseText) {
        throw new LLMProviderError('Gemini API returned an empty response.');
    }

    const rawJson = JSON.parse(responseText);

    try {
        return ExtractionSchema.parse(rawJson);
    } catch (error) {
        // Schema mismatch despite server-side enforcement — repair/retry loop territory.
        if (error instanceof ZodError) {
            throw new SchemaValidationError(error);
        }
        throw error;
    }
}