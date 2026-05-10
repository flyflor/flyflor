import type { RuntimeEvent } from "../contracts/index.ts";
import type { RuntimeEventType } from "./types.ts";

export function createRuntimeEvent(
    type: RuntimeEventType,
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
