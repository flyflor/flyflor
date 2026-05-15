import type { ModelConfig } from "../config/index.ts";
import type { ModelClient } from "../protocol/index.ts";
import { ModelProviderKind, type EventSink } from "../protocol/index.ts";
import { AnthropicCompatibleClient } from "./anthropic.client.ts";
import { OpenAICompatibleClient } from "./openai.client.ts";

export function createModelClient(config: ModelConfig, _events?: EventSink): ModelClient {
    return instantiateClient(normalizeModelClientConfig(config));
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

function normalizeModelClientConfig(config: ModelConfig): ModelConfig {
    if (config.provider) {
        return config;
    }
    // Runtime construction is the last boundary before a real HTTP client.
    // Older/minimal JSONC profiles may already be flattened but still miss
    // `provider`; a baseUrl-only model profile is OpenAI-compatible by contract.
    if (config.baseUrl && config.baseUrl.trim().length > 0) {
        return {
            ...config,
            provider: ModelProviderKind.OpenAICompatible,
        };
    }
    return config;
}
