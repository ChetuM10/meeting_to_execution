import { WorkflowState, AmbiguityFlag } from "../state";

const CONFIDENCE_THRESHOLD = 0.7;

// Node:8 - Scans validated extraction for low-confidence or incomlete action items
export async function detectAmbiguityNode(
    state: WorkflowState
): Promise<Partial<WorkflowState>> {
    if (!state.validated_extraction) {
        console.warn('[detect_ambiguity] No validated_extraction, skipping.');
        return { ambiguity_flags: [] };
    }

    const flags: AmbiguityFlag[] = [];
    const extraction = state.validated_extraction;

    // check deicisons
    extraction.decisions.forEach((d, i) => {
        if (d.confidence < CONFIDENCE_THRESHOLD) {
            flags.push({
                field: `decisions.${i}`,
                issue: `Low confidence (${d.confidence})`,
                confidence: String(d.confidence),
            });
        }
    });

    // check action items
    extraction.action_items.forEach((a, i) => {
        if (a.confidence < CONFIDENCE_THRESHOLD) {
            flags.push({
                field: `action_items.${i}`,
                issue: 'Low confidence',
                confidence: String(a.confidence),
            });
        }
        if (!a.owner) {
            flags.push({
                field: `action_items.${i}.owner`,
                issue: 'Missing owner',
                confidence: String(a.confidence),
            });
        }
        if (!a.deadline) {
            flags.push({
                field: `action_items.${i}.deadline`,
                issue: 'Missing dealine',
                confidence: String(a.confidence),
            });
        }
    });

    console.log(
        `[detect_ambiguity] Found ${flags.length} ambiguity flags.`
    );

    return { ambiguity_flags: flags };
}