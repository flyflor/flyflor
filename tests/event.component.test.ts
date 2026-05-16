import { describe, expect, test } from "bun:test";
import { Event } from "../src/agent/di/index.ts";
import { EventsComponent, NullEventSink, RuntimeEventType, RuntimeEventBus } from "../src/protocol/events/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";

class RecordingHook {
    public readonly seen: string[] = [];

    @Event(RuntimeEventType.AgentTurnStart)
    public onAgentTurnStart(event: RuntimeEvent): void {
        this.seen.push(event.type);
    }
}

class WildcardHook {
    public count = 0;

    @Event("*")
    public onAnyEvent(): void {
        this.count += 1;
    }
}

describe("EventsComponent explicit hooks", () => {
    test("emit publishes to typed subscribers through the global bus surface", () => {
        const events = new EventsComponent(new NullEventSink(), new RuntimeEventBus());
        const seen: string[] = [];

        const dispose = events.on(RuntimeEventType.AgentTurnStart, (event) => {
            seen.push(event.type);
        });
        events.emit(RuntimeEventType.AgentTurnStart, { request: "a" }, "req-1");
        dispose();
        events.emit(RuntimeEventType.AgentTurnStart, { request: "b" }, "req-2");

        expect(seen).toEqual([RuntimeEventType.AgentTurnStart]);
    });

    test("@Event metadata is registered only when the instance is explicitly hooked", () => {
        const events = new EventsComponent(new NullEventSink(), new RuntimeEventBus());
        const hook = new RecordingHook();
        const wildcard = new WildcardHook();

        const disposers = [...events.registerHooks(hook), ...events.registerHooks(wildcard)];
        events.emit(RuntimeEventType.AgentTurnStart);
        events.emit(RuntimeEventType.AgentTurnEnd);
        for (const dispose of disposers) {
            dispose();
        }
        events.emit(RuntimeEventType.AgentTurnStart);

        expect(hook.seen).toEqual([RuntimeEventType.AgentTurnStart]);
        expect(wildcard.count).toBe(2);
    });

    test("hook failures do not interrupt later subscribers", () => {
        const events = new EventsComponent(new NullEventSink(), new RuntimeEventBus());
        const seen: string[] = [];

        events.on(RuntimeEventType.AgentTurnStart, () => {
            throw new Error("hook failed");
        });
        events.on(RuntimeEventType.AgentTurnStart, (event) => {
            seen.push(event.type);
        });

        events.emit(RuntimeEventType.AgentTurnStart);

        expect(seen).toEqual([RuntimeEventType.AgentTurnStart]);
    });
});
