import { describe, expect, test } from "bun:test";
import type { ModelConfig } from "../src/config/index.ts";
import { createModelClient, OpenAICompatibleClient } from "../src/llm/index.ts";
import { ModelApiMode, ModelProviderKind } from "../src/protocol/contracts/index.ts";

describe("LLM client factory", () => {
    test("baseUrl-only flattened model config defaults to OpenAI-compatible", () => {
        const client = createModelClient({
            apiKey: "sk-test",
            apiMode: ModelApiMode.ChatCompletions,
            baseUrl: "https://relay.test/v1",
            headers: {},
            maxTokens: 4096,
            model: "gpt-5.5",
            provider: undefined,
            providerId: "relay",
            temperature: 0.2,
            timeoutMs: 60_000,
        } as unknown as ModelConfig);

        expect(client).toBeInstanceOf(OpenAICompatibleClient);
    });

    test("unsupported provider kind still fails loudly", () => {
        expect(() =>
            createModelClient({
                apiKey: "sk-test",
                apiMode: ModelApiMode.ChatCompletions,
                baseUrl: "",
                headers: {},
                maxTokens: 4096,
                model: "gpt-5.5",
                provider: "unknown-kind" as ModelProviderKind,
                providerId: "broken",
                temperature: 0.2,
                timeoutMs: 60_000,
            }),
        ).toThrow(/Unsupported model provider kind/);
    });
});
