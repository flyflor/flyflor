// 流体智力
import { FService, Inject, Service, Singleton } from "@/core";
import { ConfigComponent } from "@/shard/components/config";

/**
 * Roles accepted by the OpenAI-compatible chat-completions endpoint.
 * These values are protocol strings, not Flyflor context role names.
 */
export enum AgentChatRole {
    System = "system",
    User = "user",
    Assistant = "assistant",
}

/**
 * One message sent to the configured LLM provider.
 * `role` is the chat protocol role; `content` is the text payload for that message.
 */
export interface AgentChatMessage {
    role: AgentChatRole;
    content: string;
}

/**
 * Partial streaming shape returned by OpenAI-compatible chat completions.
 * Only the fields Flyflor consumes are represented here.
 */
interface ChatCompletionChunk {
    choices?: Array<{
        delta?: {
            content?: string;
        };
    }>;
}

/**
 * Minimal byte-stream reader contract Flyflor needs from `fetch().body.getReader()`.
 * Bun and DOM lib readers differ in extra methods, so the LLM parser depends only on `read()`.
 */
interface LlmByteStreamReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

/**
 * Model service for OpenAI-compatible chat completion providers.
 *
 * It resolves provider/model/baseURL/api-key-env from `ConfigComponent`, reads the secret from process env,
 * streams the response, and returns the assembled assistant text. It does not own agent routing or context.
 */
@Singleton()
@Service()
export class IntelligenceService extends FService {
    /** Provider endpoint suffix for chat completions. */
    private static readonly CHAT_COMPLETIONS_PATH = "/chat/completions";
    /** HTTP authorization scheme prefix. */
    private static readonly AUTHORIZATION_PREFIX = "Bearer ";
    /** Server-sent-event marker that ends a streaming completion. */
    private static readonly STREAM_DONE = "[DONE]";
    /** Sampling temperature used by the default agent. */
    private static readonly DEFAULT_TEMPERATURE = 0.7;
    /** Completion token budget for the first LLM integration milestone. */
    private static readonly MAX_COMPLETION_TOKENS = 2000;

    @Inject()
    private readonly config!: ConfigComponent;

    /**
     * Sends messages to the configured provider and returns the completed assistant text.
     * @param messages - ordered chat messages for the current stateless agent turn.
     * @returns the model-produced assistant content.
     */
    public async complete(messages: AgentChatMessage[]): Promise<string> {
        const provider = this.config.activeLlmProvider;
        const apiKey = process.env[provider.apiKeyEnv];
        if (apiKey === undefined || apiKey.length === 0) {
            throw Object.assign(Error("LLM API key environment variable is missing"), {
                detail: { provider: provider.name, apiKeyEnv: provider.apiKeyEnv },
            });
        }

        const response = await fetch(this.chatCompletionsUrl(provider.baseURL), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: IntelligenceService.AUTHORIZATION_PREFIX + apiKey,
            },
            body: JSON.stringify({
                model: provider.defaultModel,
                messages,
                stream: true,
                temperature: IntelligenceService.DEFAULT_TEMPERATURE,
                max_tokens: IntelligenceService.MAX_COMPLETION_TOKENS,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw Object.assign(Error("LLM provider request failed"), {
                detail: { provider: provider.name, status: response.status, body: errorText },
            });
        }

        const reader = response.body?.getReader();
        if (reader === undefined) {
            throw Object.assign(Error("LLM provider returned no response body"), {
                detail: { provider: provider.name },
            });
        }

        const content = await this.readStreamingContent(reader);
        if (content.length === 0) {
            throw Object.assign(Error("LLM provider returned an empty response"), {
                detail: { provider: provider.name, model: provider.defaultModel },
            });
        }
        return content;
    }

    /**
     * Builds the chat-completions endpoint URL.
     * @param baseURL - the provider base URL from config.
     * @returns a full endpoint URL with exactly one slash before the path.
     */
    private chatCompletionsUrl(baseURL: string): string {
        return baseURL.replace(/\/$/, "") + LlmService.CHAT_COMPLETIONS_PATH;
    }

    /**
     * Reads an SSE stream from an OpenAI-compatible provider and assembles text deltas.
     * @param reader - response body reader returned by `fetch`.
     * @returns the concatenated assistant content.
     */
    private async readStreamingContent(reader: LlmByteStreamReader): Promise<string> {
        const decoder = new TextDecoder();
        let full = "";
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const delta = this.parseStreamingLine(line);
                if (delta !== undefined) {
                    full += delta;
                }
            }
        }

        return full;
    }

    /**
     * Parses one server-sent-event line from a streaming chat completion.
     * @param line - the raw line from the stream buffer.
     * @returns a content delta when the line carries one; otherwise `undefined`.
     */
    private parseStreamingLine(line: string): string | undefined {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
            return undefined;
        }
        const data = trimmed.slice("data:".length).trim();
        if (data === LlmService.STREAM_DONE) {
            return undefined;
        }
        const parsed = JSON.parse(data) as ChatCompletionChunk;
        const delta = parsed.choices?.[0]?.delta?.content;
        return typeof delta === "string" ? delta : undefined;
    }
}
