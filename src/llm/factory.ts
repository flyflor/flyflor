import type { ModelConfig } from "../config/index.ts";
import type { ModelClient } from "../protocol/index.ts";
import { ModelProviderKind } from "../protocol/index.ts";
import { AnthropicCompatibleClient } from "./anthropic.client.ts";
import { MockModelClient } from "./mock.client.ts";
import { OpenAICompatibleClient } from "./openai.client.ts";

export function createModelClient(config: ModelConfig): ModelClient {
    if (config.provider === ModelProviderKind.OpenAICompatible) {
        return new OpenAICompatibleClient(config);
    }
    if (config.provider === ModelProviderKind.AnthropicCompatible) {
        return new AnthropicCompatibleClient(config);
    }
    return new MockModelClient();
}
