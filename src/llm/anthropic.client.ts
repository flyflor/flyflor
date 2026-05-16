import type { ModelConfig } from "../config/index.ts";
import type { ModelClient, ModelMessage } from "../protocol/index.ts";
import { assertStreamResponse, fetchModelEndpoint, normalizeAnthropicBaseUrl, readSseJson } from "./http.ts";

interface AnthropicMessagesResponse {
    content?: Array<{
        text?: string;
        type?: string;
    }>;
    error?: {
        message?: string;
    };
}

interface AnthropicMessagesStreamChunk {
    delta?: {
        text?: string;
    };
    type?: string;
}

export class AnthropicCompatibleClient implements ModelClient {
    constructor(private readonly config: ModelConfig) {}

    async generate(messages: ModelMessage[], options: { signal?: AbortSignal } = {}): Promise<string> {
        this.assertApiKey();
        const { system, userMessages } = splitMessages(messages);
        const response = await fetchModelEndpoint(this.config, "/v1/messages", {
            method: "POST",
            headers: {
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                [this.config.apiKeyHeader ?? "x-api-key"]: this.apiKeyValue(),
                ...this.config.headers,
            },
            body: JSON.stringify({
                model: this.config.model,
                system: system || undefined,
                messages: userMessages,
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
            }),
        }, normalizeAnthropicBaseUrl, options);
        const payload = (await response.json()) as AnthropicMessagesResponse;
        if (!response.ok) {
            throw new Error(payload.error?.message ?? `Model request failed: ${response.status}`);
        }
        const content = payload.content
            ?.filter((part) => part.type === "text" && part.text)
            .map((part) => part.text)
            .join("");
        if (!content) {
            throw new Error("Model returned an empty response");
        }
        return content;
    }

    async *stream(messages: ModelMessage[], options: { signal?: AbortSignal } = {}): AsyncGenerator<string> {
        this.assertApiKey();
        const { system, userMessages } = splitMessages(messages);
        const response = await fetchModelEndpoint(this.config, "/v1/messages", {
            method: "POST",
            headers: {
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                [this.config.apiKeyHeader ?? "x-api-key"]: this.apiKeyValue(),
                ...this.config.headers,
            },
            body: JSON.stringify({
                model: this.config.model,
                system: system || undefined,
                messages: userMessages,
                max_tokens: this.config.maxTokens,
                stream: true,
                temperature: this.config.temperature,
            }),
        }, normalizeAnthropicBaseUrl, options);
        await assertStreamResponse(response);
        for await (const chunk of readSseJson<AnthropicMessagesStreamChunk>(response)) {
            if (chunk.type === "content_block_delta" && chunk.delta?.text) {
                yield chunk.delta.text;
            }
        }
    }

    private assertApiKey(): void {
        if (!this.config.apiKey || typeof this.config.apiKey !== "string") {
            throw new Error("Missing model API key");
        }
    }

    private apiKeyValue(): string {
        this.assertApiKey();
        return this.config.apiKey as string;
    }
}

function splitMessages(messages: ModelMessage[]): {
    system: string;
    userMessages: Array<{ content: string; role: "assistant" | "user" }>;
} {
    const system = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
    const userMessages: Array<{ content: string; role: "assistant" | "user" }> = messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content,
        }));
    return { system, userMessages };
}
