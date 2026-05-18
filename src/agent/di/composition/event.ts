import type { RuntimeEvent } from "../../../protocol/contracts/index.ts";
import type { RuntimeEventType } from "../../../events/types.ts";

export type EventHandlerSelector = RuntimeEventType | "*";

export interface EventHandlerMetadata {
    propertyKey: string | symbol;
    selector: EventHandlerSelector;
}

export type EventHandler = (event: RuntimeEvent) => void | Promise<void>;

const eventMetadata = new WeakMap<Function, EventHandlerMetadata[]>();

export function registerEventMetadata(
    target: object,
    propertyKey: string | symbol,
    selector: EventHandlerSelector,
): void {
    const constructor = typeof target === "function" ? target : target.constructor;
    const entries = eventMetadata.get(constructor) ?? [];
    entries.push({ propertyKey, selector });
    eventMetadata.set(constructor, entries);
}

export function readEventMetadata(target: Function): EventHandlerMetadata[] {
    return [...(eventMetadata.get(target) ?? [])];
}

