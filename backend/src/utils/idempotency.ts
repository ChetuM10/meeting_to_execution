import { createHash } from "crypto";

export function generateIdempotencyKey(
    workflowRunId: string,
    actionType: string,
    payload: Record<string, any>
): string {
    const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort());

    const raw = `${workflowRunId}:${actionType}:${payload}`;

    return createHash('sha256').update(raw).digest('hex');
}