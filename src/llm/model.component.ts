import { FlyflorComponent } from "../components/index.ts";
import type { ModelClient, ModelMessage } from "../protocol/contracts/index.ts";

/**
 * Active model component.
 *
 * The component wraps the provider-specific client. This gives DI a concrete
 * runtime boundary while preserving the ModelClient contract used by workers,
 * runtime routing and reflection.
 */
export class ModelComponent extends FlyflorComponent implements ModelClient {
    public constructor(private readonly client: ModelClient) {
        super();
    }

    public generate(messages: ModelMessage[], options: { signal?: AbortSignal } = {}): Promise<string> {
        return this.client.generate(messages, options);
    }

    public async *stream(messages: ModelMessage[], options: { signal?: AbortSignal } = {}): AsyncIterable<string> {
        if (this.client.stream) {
            yield* this.client.stream(messages, options);
            return;
        }
        // Some providers only implement non-streaming generation; expose the
        // same ModelClient surface by yielding the final text as one chunk.
        yield await this.client.generate(messages, options);
    }

    public unwrap(): ModelClient {
        return this.client;
    }
}
