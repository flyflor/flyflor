import { FlyflorComponent } from "../../components/index.ts";
import { createRuntimeEvent } from "./runtime.event.ts";
import { readEventMetadata, type EventHandler } from "../../agent/di/composition/index.ts";
import type { RuntimeEvent } from "../contracts/index.ts";
import { globalEvents, RuntimeEventBus } from "./bus.ts";
import type { EventSink, RuntimeEventType } from "./types.ts";

/**
 * Runtime event component.
 *
 * It fan-outs every runtime event to the configured sink and the process-wide
 * event bus. The global bus is the hook surface for TUI, decorators and future
 * plugin observers; side-effect sinks stay configured at the composition root.
 */
export class EventsComponent extends FlyflorComponent implements EventSink {
    private readonly pendingHooks = new Set<Promise<void>>();

    public constructor(private readonly sink: EventSink, private readonly bus: RuntimeEventBus = globalEvents) {
        super();
    }

    public publish(event: RuntimeEvent): void {
        this.sink.publish(event);
        if (this.sink !== this.bus) {
            this.bus.publish(event);
        }
    }

    public emit(type: RuntimeEventType, payload?: Record<string, unknown>, requestId?: string): RuntimeEvent {
        const runtimeEvent = createRuntimeEvent(type, payload, requestId);
        this.publish(runtimeEvent);
        return runtimeEvent;
    }

    public on(type: RuntimeEventType | "*", handler: EventHandler): () => void {
        const sink: EventSink = {
            publish: (runtimeEvent) => {
                if (type !== "*" && runtimeEvent.type !== type) {
                    return;
                }
                try {
                    const result = handler(runtimeEvent);
                    if (result instanceof Promise) {
                        const pending = result.catch(() => {}).finally(() => {
                            this.pendingHooks.delete(pending);
                        });
                        this.pendingHooks.add(pending);
                    }
                } catch {
                    // Event hooks are observers; failures must not interrupt
                    // runtime event delivery or the primary audit sink.
                }
            },
        };
        return this.subscribe(sink);
    }

    public registerHooks(instance: object): Array<() => void> {
        return readEventMetadata(instance.constructor).map((metadata) => {
            const maybeHandler = (instance as Record<string | symbol, unknown>)[metadata.propertyKey];
            if (typeof maybeHandler !== "function") {
                throw new Error(`Invalid @Event handler: ${instance.constructor.name}.${String(metadata.propertyKey)}`);
            }
            return this.on(metadata.selector, (runtimeEvent) => maybeHandler.call(instance, runtimeEvent));
        });
    }

    public subscribe(sink: EventSink): () => void {
        return this.bus.subscribe(sink);
    }

    public asSink(): EventSink {
        return this;
    }

    public asBus(): RuntimeEventBus {
        return this.bus;
    }

    public async flush(): Promise<void> {
        await Promise.all([...this.pendingHooks]);
    }
}
