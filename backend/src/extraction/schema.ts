import { z } from 'zod';

export const DecisionSchema = z.object({
    content: z.string().min(1),
    confidence: z.number().min(0).max(1),
    source_quote: z.string(),
});

export const ActionItemSchema = z.object({
    task: z.string().min(1),
    owner: z.string().nullable(),
    deadline: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    ambiguity_flags: z.array(z.string()),
});

export const OpenQuestionSchema = z.object({
    question: z.string().min(1),
    status: z.literal('open'),
});

// Combined extraction
export const ExtractionSchema = z.object({
    decisions: z.array(DecisionSchema),
    action_items: z.array(ActionItemSchema),
    open_questions: z.array(OpenQuestionSchema),
});

export type Decision = z.infer<typeof DecisionSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type ExtractionResult = z.infer<typeof ExtractionSchema>;