import type { RuntimeEvent } from "../contracts/index.ts";
import type { EventSink } from "./types.ts";

export class GlobalEventBus implements EventSink {
    private readonly sinks = new Set<EventSink>();

    public subscribe(sink: EventSink): () => void {
        this.sinks.add(sink);
        return () => this.sinks.delete(sink);
    }

    public publish(event: RuntimeEvent): void {
        for (const sink of this.sinks) {
            sink.publish(event);
        }
    }
}

export const globalEvents = new GlobalEventBus();
export { GlobalEventBus as FpcEventBus, GlobalEventBus as RuntimeEventBus };
