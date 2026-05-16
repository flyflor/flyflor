import type { ModelConfig } from "../config/index.ts";
import type { ModelClient, ModelMessage } from "../protocol/index.ts";
import { ModelApiMode } from "../protocol/index.ts";
import { assertStreamResponse, fetchModelEndpoint, normalizeOpenAIBaseUrl, readSseJson } from "./http.ts";

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

interface ChatCompletionStreamChunk {
    choices?: Array<{
        delta?: {
            content?: string;
        };
    }>;
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

interface ResponsesApiStreamChunk {
    delta?: string;
    output_text?: string;
    response?: {
        output_text?: string;
    };
    text?: string;
    type?: string;
}

export class OpenAICompatibleClient implements ModelClient {
    constructor(private readonly config: ModelConfig) {}

    async generate(messages: ModelMessage[], options: { signal?: AbortSignal } = {}): Promise<string> {
        this.assertApiKey();
        if (this.config.apiMode === ModelApiMode.Responses) {
            return this.generateWithResponsesApi(messages, options);
        }
        const response = await fetchModelEndpoint(this.config, "/v1/chat/completions", {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({
                model: this.config.model,
                messages,
                temperature: this.config.temperature,
            }),
        }, normalizeOpenAIBaseUrl, options);
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

    async *stream(messages: ModelMessage[], options: { signal?: AbortSignal } = {}): AsyncGenerator<string> {
        this.assertApiKey();
        if (this.config.apiMode === ModelApiMode.Responses) {
            yield* this.streamWithResponsesApi(messages, options);
            return;
        }
        const response = await fetchModelEndpoint(this.config, "/v1/chat/completions", {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({
                model: this.config.model,
                messages,
                stream: true,
                temperature: this.config.temperature,
            }),
        }, normalizeOpenAIBaseUrl, options);
        await assertStreamResponse(response);
        for await (const chunk of readSseJson<ChatCompletionStreamChunk>(response)) {
            const text = chunk.choices?.[0]?.delta?.content;
            if (text) {
                yield text;
            }
        }
    }

    private async generateWithResponsesApi(
        messages: ModelMessage[],
        options: { signal?: AbortSignal } = {},
    ): Promise<string> {
        const response = await fetchModelEndpoint(this.config, "/v1/responses", {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({
                model: this.config.model,
                input: messages,
                max_output_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
            }),
        }, normalizeOpenAIBaseUrl, options);
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

    private async *streamWithResponsesApi(
        messages: ModelMessage[],
        options: { signal?: AbortSignal } = {},
    ): AsyncGenerator<string> {
        const response = await fetchModelEndpoint(this.config, "/v1/responses", {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({
                model: this.config.model,
                input: messages,
                max_output_tokens: this.config.maxTokens,
                stream: true,
                temperature: this.config.temperature,
            }),
        }, normalizeOpenAIBaseUrl, options);
        await assertStreamResponse(response);
        let emittedDelta = false;
        for await (const chunk of readSseJson<ResponsesApiStreamChunk>(response)) {
            if (chunk.type === "response.output_text.delta" && chunk.delta) {
                emittedDelta = true;
                yield chunk.delta;
            } else if (chunk.type === "output_text.delta" && chunk.delta) {
                emittedDelta = true;
                yield chunk.delta;
            } else if (
                !emittedDelta &&
                (chunk.type === "response.output_text.done" || chunk.type === "output_text.done") &&
                chunk.text
            ) {
                emittedDelta = true;
                yield chunk.text;
            } else if (chunk.output_text) {
                emittedDelta = true;
                yield chunk.output_text;
            } else if (!emittedDelta && chunk.type === "response.completed" && chunk.response?.output_text) {
                emittedDelta = true;
                yield chunk.response.output_text;
            }
        }
    }

    private assertApiKey(): void {
        if (!this.config.apiKey || typeof this.config.apiKey !== "string") {
            throw new Error("Missing model API key");
        }
    }

    private headers(): Record<string, string> {
        const apiKey = this.apiKeyValue();
        return {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            ...this.config.headers,
        };
    }

    private apiKeyValue(): string {
        this.assertApiKey();
        return this.config.apiKey as string;
    }
}

function extractResponsesText(payload: ResponsesApiResponse): string | undefined {
    const content = payload.output
        ?.flatMap((item) => item.content ?? [])
        .filter((part) => (part.type === "output_text" || part.type === "text") && part.text)
        .map((part) => part.text)
        .join("");
    return content || undefined;
}
