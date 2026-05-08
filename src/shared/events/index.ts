import type { RuntimeEvent } from "../core/types.ts";

export interface EventSink {
    publish(event: RuntimeEvent): void;
}

export class ConsoleEventSink implements EventSink {
    publish(event: RuntimeEvent): void {
        console.error(JSON.stringify(event));
    }
}

export class NullEventSink implements EventSink {
    publish(_event: RuntimeEvent): void {}
}

export function event(type: string, payload?: Record<string, unknown>, requestId?: string): RuntimeEvent {
    return {
        type,
        at: new Date().toISOString(),
        requestId,
        payload,
    };
}
