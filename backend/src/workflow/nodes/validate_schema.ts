import { WorkflowState } from '../state';
import { ExtractionSchema } from '../../extraction/schema';

// Node: 4 - Runs Zod validation on the draft extraction to confirm it matches the schema.
export async function validateSchemaNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    if (!state.draft_extraction) {
        console.warn('[validate_schema] No draft_extraction to validate.');
        return {
            validation_error: 'No draft extraction available to validate.',
        };
    }

    const result = ExtractionSchema.safeParse(state.draft_extraction);

    if (result.success) {
        console.log('[validate_schema] Schema validation passed.');
        return {
            validated_extraction: result.data,
            validation_error: null,
        };
    }

    const errorMessage = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');

    console.warn('[validate_schema] Validation failed:', errorMessage);
    return {
        validation_error: errorMessage,
    };
}
