import type { RuntimeEvent } from "../contracts/index.ts";
import type { EventSink } from "./types.ts";

export class ConsoleEventSink implements EventSink {
    publish(event: RuntimeEvent): void {
        console.error(JSON.stringify(event));
    }
}

export class NullEventSink implements EventSink {
    publish(_event: RuntimeEvent): void {}
}
