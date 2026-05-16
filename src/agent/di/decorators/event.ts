import { registerEventMetadata, type EventHandlerSelector } from "../composition/index.ts";

/**
 * Registers an explicit runtime-event hook on a class method.
 *
 * No reflect metadata is used: the event type is always passed directly, and
 * instances are registered explicitly through EventsComponent.
 */
export function Event(selector: EventHandlerSelector): MethodDecorator {
    return (target, propertyKey) => {
        registerEventMetadata(target, propertyKey, selector);
    };
}

