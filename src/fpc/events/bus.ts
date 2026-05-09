import type { RuntimeEvent } from "../contracts/index.ts";
import type { EventSink } from "./types.ts";

export class FpcEventBus implements EventSink {
    private readonly sinks = new Set<EventSink>();

    subscribe(sink: EventSink): () => void {
        this.sinks.add(sink);
        return () => this.sinks.delete(sink);
    }

    publish(event: RuntimeEvent): void {
        for (const sink of this.sinks) {
            sink.publish(event);
        }
    }
}

export const globalEvents = new FpcEventBus();
