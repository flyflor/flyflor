import type { ModelConfig } from "../config/index.ts";
import type { ModelClient } from "../protocol/index.ts";
import { ModelProviderKind, type EventSink } from "../protocol/index.ts";
import { AnthropicCompatibleClient } from "./anthropic.client.ts";
import { FallbackModelClient } from "./fallback.client.ts";
import { MockModelClient } from "./mock.client.ts";
import { OpenAICompatibleClient } from "./openai.client.ts";

export function createModelClient(config: ModelConfig, events?: EventSink): ModelClient {
    const primary = instantiateClient(config);
    if (!config.fallbacks || config.fallbacks.length === 0) {
        return primary;
    }
    const fallbacks = config.fallbacks.map((fb) => ({
        providerId: fb.providerId,
        config: fb,
        client: instantiateClient(fb),
    }));
    return new FallbackModelClient({ providerId: config.providerId, config, client: primary }, fallbacks, events);
}

function instantiateClient(config: ModelConfig): ModelClient {
    if (config.provider === ModelProviderKind.OpenAICompatible) {
        return new OpenAICompatibleClient(config);
    }
    if (config.provider === ModelProviderKind.AnthropicCompatible) {
        return new AnthropicCompatibleClient(config);
    }
    return new MockModelClient();
}
