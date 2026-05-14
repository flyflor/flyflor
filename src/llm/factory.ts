import type { ModelConfig } from "../config/index.ts";
import type { ModelClient } from "../protocol/index.ts";
import { ModelProviderKind, type EventSink } from "../protocol/index.ts";
import { AnthropicCompatibleClient } from "./anthropic.client.ts";
import { OpenAICompatibleClient } from "./openai.client.ts";

export function createModelClient(config: ModelConfig, _events?: EventSink): ModelClient {
    return instantiateClient(config);
}

function instantiateClient(config: ModelConfig): ModelClient {
    if (config.provider === ModelProviderKind.OpenAICompatible) {
        return new OpenAICompatibleClient(config);
    }
    if (config.provider === ModelProviderKind.AnthropicCompatible) {
        return new AnthropicCompatibleClient(config);
    }
    throw new Error(`Unsupported model provider kind: ${config.provider}`);
}
