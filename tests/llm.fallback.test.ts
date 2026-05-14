import { describe, expect, test } from "bun:test";
import { FallbackModelClient } from "../src/llm/fallback.client.ts";
import type { ModelClient, ModelMessage } from "../src/protocol/index.ts";
import { ModelApiMode, ModelProviderKind, RuntimeEventType, type EventSink } from "../src/protocol/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";
import type { ModelConfig } from "../src/config/index.ts";

function makeConfig(providerId: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
    return {
        apiMode: ModelApiMode.ChatCompletions,
        providerId,
        provider: ModelProviderKind.OpenAICompatible,
        baseUrl: "https://example.test",
        apiKey: "sk-test",
        headers: {},
        maxTokens: 1024,
        model: "gpt-test",
        temperature: 0,
        timeoutMs: 1000,
        ...overrides,
    };
}

class StubClient implements ModelClient {
    constructor(private readonly behavior: () => Promise<string>) {}
    async generate(_: ModelMessage[]): Promise<string> {
        return this.behavior();
    }
}

class CapturingSink implements EventSink {
    events: RuntimeEvent[] = [];
    publish(e: RuntimeEvent): void {
        this.events.push(e);
    }
}

describe("FallbackModelClient", () => {
    test("primary succeeds → no fallback events", async () => {
        const sink = new CapturingSink();
        const client = new FallbackModelClient(
            { providerId: "openai", config: makeConfig("openai"), client: new StubClient(async () => "ok") },
            [],
            sink,
        );
        await expect(client.generate([])).resolves.toBe("ok");
        expect(sink.events).toHaveLength(0);
    });

    test("primary throws → fallback succeeds and emits ProviderFallbackTriggered", async () => {
        const sink = new CapturingSink();
        const client = new FallbackModelClient(
            {
                providerId: "openai",
                config: makeConfig("openai"),
                client: new StubClient(async () => {
                    throw new Error("boom");
                }),
            },
            [
                {
                    providerId: "anthropic",
                    config: makeConfig("anthropic"),
                    client: new StubClient(async () => "fallback-ok"),
                },
            ],
            sink,
        );
        await expect(client.generate([])).resolves.toBe("fallback-ok");
        const types = sink.events.map((e) => e.type);
        expect(types).toContain(RuntimeEventType.ProviderRequestFailed);
        expect(types).toContain(RuntimeEventType.ProviderFallbackTriggered);
    });

    test("primary missing credentials → skips to fallback and emits ProviderCredentialMissing", async () => {
        const sink = new CapturingSink();
        const client = new FallbackModelClient(
            {
                providerId: "openai",
                config: makeConfig("openai", { apiKey: "" }),
                client: new StubClient(async () => "should-not-be-called"),
            },
            [
                {
                    providerId: "local",
                    config: makeConfig("local", { provider: ModelProviderKind.OpenAICompatible }),
                    client: new StubClient(async () => "local-ok"),
                },
            ],
            sink,
        );
        await expect(client.generate([])).resolves.toBe("local-ok");
        const types = sink.events.map((e) => e.type);
        expect(types).toContain(RuntimeEventType.ProviderCredentialMissing);
        expect(types).toContain(RuntimeEventType.ProviderFallbackTriggered);
    });

    test("all providers fail → throws last error", async () => {
        const client = new FallbackModelClient(
            {
                providerId: "openai",
                config: makeConfig("openai"),
                client: new StubClient(async () => {
                    throw new Error("first");
                }),
            },
            [
                {
                    providerId: "anthropic",
                    config: makeConfig("anthropic"),
                    client: new StubClient(async () => {
                        throw new Error("second");
                    }),
                },
            ],
        );
        await expect(client.generate([])).rejects.toThrow("second");
    });
});
