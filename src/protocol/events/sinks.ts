import type { RuntimeEvent } from "../contracts/index.ts";
import type { EventSink } from "./types.ts";

export class ConsoleEventSink implements EventSink {
    public publish(event: RuntimeEvent): void {
        console.error(JSON.stringify(event));
    }
}

export class NullEventSink implements EventSink {
    public publish(_event: RuntimeEvent): void {}
}

/** 把多个 sink fan-out 成单个 sink；任一 sink 抛错被吞掉以防互相影响。 */
export class CompositeEventSink implements EventSink {
    public constructor(private readonly sinks: EventSink[]) {}
    public publish(event: RuntimeEvent): void {
        for (const sink of this.sinks) {
            try {
                sink.publish(event);
            } catch (err) {
                console.warn(`[composite-sink] sink failed: ${String(err)}`);
            }
        }
    }
}
