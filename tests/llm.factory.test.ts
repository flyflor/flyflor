import { describe, expect, test } from "bun:test";
import type { ModelConfig } from "../src/config/index.ts";
import { createModelClient, OpenAICompatibleClient } from "../src/cognitive/mindstream/index.ts";
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

    test("model request timeouts keep their name and include request context", async () => {
        const previousFetch = globalThis.fetch;
        const failingFetch = () => {
            const error = new Error("The operation timed out.");
            error.name = "TimeoutError";
            return Promise.reject(error);
        };
        globalThis.fetch = failingFetch as unknown as typeof fetch;
        try {
            const client = new OpenAICompatibleClient({
                apiKey: "sk-test",
                apiMode: ModelApiMode.ChatCompletions,
                baseUrl: "https://relay.test/v1",
                headers: {},
                maxTokens: 4096,
                model: "gpt-test",
                provider: ModelProviderKind.OpenAICompatible,
                providerId: "relay",
                temperature: 0.2,
                timeoutMs: 1234,
            });

            await expect(client.generate([{ role: "user", content: "hello" }])).rejects.toThrow(
                /provider=relay model=gpt-test .* timeoutMs=1234/,
            );
            await expect(client.generate([{ role: "user", content: "hello" }])).rejects.toHaveProperty(
                "name",
                "TimeoutError",
            );
        } finally {
            globalThis.fetch = previousFetch;
        }
    });

    test("deepseek uses the documented root chat completions endpoint", async () => {
        const previousFetch = globalThis.fetch;
        let capturedUrl = "";
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
            capturedUrl = String(input);
            return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
                headers: { "content-type": "application/json" },
            });
        }) as unknown as typeof fetch;
        try {
            const client = new OpenAICompatibleClient({
                apiKey: "test-deepseek-key",
                apiMode: ModelApiMode.ChatCompletions,
                baseUrl: "https://api.deepseek.com",
                headers: {},
                maxTokens: 4096,
                model: "deepseek-v4-flash",
                provider: ModelProviderKind.OpenAICompatible,
                providerId: "deepseek",
                temperature: 0.2,
                timeoutMs: 60_000,
            });

            await expect(client.generate([{ role: "user", content: "hello" }])).resolves.toBe("ok");
            expect(capturedUrl).toBe("https://api.deepseek.com/chat/completions");
        } finally {
            globalThis.fetch = previousFetch;
        }
    });

    test("chat completions requests do not need native tool-role messages for Flyflor tool results", async () => {
        const previousFetch = globalThis.fetch;
        let capturedBody: unknown;
        globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            capturedBody = JSON.parse(String(init?.body ?? "{}"));
            return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
                headers: { "content-type": "application/json" },
            });
        }) as unknown as typeof fetch;
        try {
            const client = new OpenAICompatibleClient({
                apiKey: "test-deepseek-key",
                apiMode: ModelApiMode.ChatCompletions,
                baseUrl: "https://api.deepseek.com",
                headers: {},
                maxTokens: 4096,
                model: "deepseek-v4-flash",
                provider: ModelProviderKind.OpenAICompatible,
                providerId: "deepseek",
                temperature: 0.2,
                timeoutMs: 60_000,
            });

            await expect(
                client.generate([
                    { role: "assistant", content: "<flyflor_mcp_calls>{}</flyflor_mcp_calls>" },
                    { role: "user", content: '{"mcpToolResults":{"results":[]}}' },
                ]),
            ).resolves.toBe("ok");
            const messages = (capturedBody as { messages?: Array<{ role?: string }> }).messages ?? [];
            expect(messages.map((message) => message.role)).toEqual(["assistant", "user"]);
            expect(messages.some((message) => message.role === "tool")).toBe(false);
        } finally {
            globalThis.fetch = previousFetch;
        }
    });
});
