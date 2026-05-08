import type { ModelClient, ModelMessage } from "../../shared/core/types.ts";
import type { ModelConfig } from "../../config/index.ts";
import { ModelApiMode, ModelProviderKind } from "../../shared/core/enums.ts";

interface ChatCompletionResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
    error?: {
        message?: string;
    };
}

interface ResponsesApiResponse {
    output_text?: string;
    output?: Array<{
        content?: Array<{
            text?: string;
            type?: string;
        }>;
        type?: string;
    }>;
    error?: {
        message?: string;
    };
}

interface AnthropicMessagesResponse {
    content?: Array<{
        text?: string;
        type?: string;
    }>;
    error?: {
        message?: string;
    };
}

export class OpenAICompatibleClient implements ModelClient {
    constructor(private readonly config: ModelConfig) {}

    async generate(messages: ModelMessage[]): Promise<string> {
        if (!this.config.apiKey || typeof this.config.apiKey !== "string") {
            throw new Error("Missing model API key");
        }

        if (this.config.apiMode === ModelApiMode.Responses) {
            return this.generateWithResponsesApi(messages);
        }

        const url = new URL("/v1/chat/completions", normalizeBaseUrl(this.config.baseUrl));
        const response = await fetch(url, {
            method: "POST",
            headers: {
                authorization: `Bearer ${this.config.apiKey}`,
                "content-type": "application/json",
                ...this.config.headers,
            },
            body: JSON.stringify({
                model: this.config.model,
                messages,
                temperature: this.config.temperature,
            }),
            signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        const payload = (await response.json()) as ChatCompletionResponse;
        if (!response.ok) {
            throw new Error(payload.error?.message ?? `Model request failed: ${response.status}`);
        }

        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Model returned an empty response");
        }
        return content;
    }

    private async generateWithResponsesApi(messages: ModelMessage[]): Promise<string> {
        const response = await fetch(new URL("/v1/responses", normalizeBaseUrl(this.config.baseUrl)), {
            method: "POST",
            headers: {
                authorization: `Bearer ${this.config.apiKey}`,
                "content-type": "application/json",
                ...this.config.headers,
            },
            body: JSON.stringify({
                model: this.config.model,
                input: messages,
                max_output_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
            }),
            signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        const payload = (await response.json()) as ResponsesApiResponse;
        if (!response.ok) {
            throw new Error(payload.error?.message ?? `Model request failed: ${response.status}`);
        }

        const content = payload.output_text ?? extractResponsesText(payload);
        if (!content) {
            throw new Error("Model returned an empty response");
        }
        return content;
    }
}

export class AnthropicCompatibleClient implements ModelClient {
    constructor(private readonly config: ModelConfig) {}

    async generate(messages: ModelMessage[]): Promise<string> {
        if (!this.config.apiKey || typeof this.config.apiKey !== "string") {
            throw new Error("Missing model API key");
        }

        const system = messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n\n");
        const userMessages = messages
            .filter((message) => message.role !== "system")
            .map((message) => ({
                role: message.role === "assistant" ? "assistant" : "user",
                content: message.content,
            }));

        const response = await fetch(new URL("/v1/messages", normalizeBaseUrl(this.config.baseUrl)), {
            method: "POST",
            headers: {
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                [this.config.apiKeyHeader ?? "x-api-key"]: this.config.apiKey,
                ...this.config.headers,
            },
            body: JSON.stringify({
                model: this.config.model,
                system: system || undefined,
                messages: userMessages,
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
            }),
            signal: AbortSignal.timeout(this.config.timeoutMs),
        });

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
}

export class MockModelClient implements ModelClient {
    async generate(messages: ModelMessage[]): Promise<string> {
        const lastUser = [...messages].reverse().find((message) => message.role === "user");
        return `Mock model is active. Received: ${lastUser?.content ?? ""}`;
    }
}

export function createModelClient(config: ModelConfig): ModelClient {
    if (config.provider === ModelProviderKind.OpenAICompatible) {
        return new OpenAICompatibleClient(config);
    }
    if (config.provider === ModelProviderKind.AnthropicCompatible) {
        return new AnthropicCompatibleClient(config);
    }
    return new MockModelClient();
}

function normalizeBaseUrl(value: string): string {
    return value.endsWith("/v1") ? value.slice(0, -3) : value.replace(/\/$/, "");
}

function extractResponsesText(payload: ResponsesApiResponse): string | undefined {
    const content = payload.output
        ?.flatMap((item) => item.content ?? [])
        .filter((part) => (part.type === "output_text" || part.type === "text") && part.text)
        .map((part) => part.text)
        .join("");
    return content || undefined;
}
