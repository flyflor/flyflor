import type { RuntimeEvent } from "../contracts/index.ts";
import type { FpcEventType } from "../events/types.ts";

export function createRuntimeEvent(
    type: FpcEventType,
    payload?: Record<string, unknown>,
    requestId?: string,
): RuntimeEvent {
    return {
        type,
        at: new Date().toISOString(),
        requestId,
        payload,
    };
}
