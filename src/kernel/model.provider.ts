import { Component } from "../di";
import { ConfigService } from "../config/config.service";
import type { ContextIntentModelRequest, ContextMessage } from "../context";
import type { MemoryRecallResult } from "../memory";
import type { NormalizedProviderConfig } from "../config/config.types";
import type { ToolDefinition } from "../tools";

/**
 * Describes a model provider request.
 *
 * @property model - Configured model id.
 * @property messages - Fully assembled no-session context messages.
 * @property userInput - Current user input.
 * @property recall - Memory recall diagnostics used by deterministic providers.
 * @usage AgentRuntimeService passes this shape to provider adapters.
 */
export interface ModelRequest {
  readonly model: string;
  readonly messages: readonly ContextMessage[];
  readonly userInput: string;
  readonly recall: readonly MemoryRecallResult[];
  readonly tools?: readonly ToolDefinition[];
}

/**
 * Describes one streamed model event.
 *
 * @property type - Event kind emitted by the provider.
 * @property text - Optional assistant text delta or final text.
 * @usage Runtime turns provider events into SignalBus and socket events.
 */
export interface ModelStreamEvent {
  readonly type: "delta" | "reasoning" | "tool_call" | "final";
  readonly text?: string;
  readonly toolCall?: ModelToolCall;
}

/**
 * Describes one model-requested tool call.
 *
 * @property id - Provider tool call id or generated local id when the stream omits one.
 * @property name - Tool name requested by the model.
 * @property argumentsJson - Raw JSON argument string produced by the provider.
 * @usage AgentRuntimeService parses this and executes the matching ToolRegistry entry.
 */
export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

/**
 * Describes the model adapter contract.
 *
 * @param request - Model request containing context and current user input.
 * @returns Async stream of model events.
 * @usage Provider adapters implement this interface for decision and streaming calls.
 */
export interface ModelProvider {
  analyzeIntent?(request: ContextIntentModelRequest): Promise<string>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

/**
 * Calls OpenAI-compatible chat completion providers with streaming support.
 *
 * @usage Runtime uses this for DeepSeek and other compatible base URLs.
 */
@Component()
export class OpenAICompatibleModelProvider implements ModelProvider {
  public constructor(private readonly configService = new ConfigService()) {}

  /**
   * Runs a non-streaming model-backed intent classification call.
   *
   * @param request - Intent prompt and current user input.
   * @returns Raw provider text containing the intent JSON object.
   * @usage ContextIntentAnalyzerComponent parses and validates the returned JSON.
   */
  public async analyzeIntent(request: ContextIntentModelRequest): Promise<string> {
    const provider = this.resolveProvider();
    if (!provider.api_key) {
      throw new Error(`Missing API key for provider ${provider.name}`);
    }
    const response = await fetch(`${provider.base_url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${provider.api_key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((message) => ({
          role: message.role === "tool" ? "user" : message.role,
          content: message.content,
        })),
        stream: false,
        temperature: 0,
        max_tokens: 2400,
      }),
      signal: AbortSignal.timeout(provider.request_timeout_seconds * 1000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Provider ${provider.name} intent failed ${response.status}: ${text.slice(0, 800)}`);
    }
    const parsed = await response.json() as OpenAICompatibleCompletion;
    return parsed.choices?.[0]?.message?.content ?? "";
  }

  /**
   * Streams assistant text from the configured OpenAI-compatible provider.
   *
   * @param request - Model request with context messages and current model id.
   * @returns Stream of delta and final events.
   * @usage DeepSeek uses this path through `/chat/completions`.
   */
  public async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const provider = this.resolveProvider();
    if (!provider.api_key) {
      throw new Error(`Missing API key for provider ${provider.name}`);
    }
    const response = await fetch(`${provider.base_url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${provider.api_key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((message) => ({
          role: message.role === "tool" ? "user" : message.role,
          content: message.content,
        })),
        ...(request.tools && request.tools.length > 0 ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.schema,
            },
          })),
          tool_choice: "auto",
        } : {}),
        stream: true,
        ...this.modelOutputBudget(request.model, provider),
      }),
      signal: AbortSignal.timeout(provider.request_timeout_seconds * 1000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Provider ${provider.name} failed ${response.status}: ${text.slice(0, 800)}`);
    }
    if (!response.body) {
      throw new Error(`Provider ${provider.name} returned no response body`);
    }
    let finalText = "";
    for await (const event of this.readSseDeltas(response.body)) {
      if (event.type === "delta" && event.text) {
        finalText += event.text;
      }
      yield event;
    }
    yield { type: "final", text: finalText };
  }

  /**
   * Resolves the active provider or direct model provider config.
   *
   * @returns Normalized provider config.
   * @usage Keeps provider selection compatible with Hermes-style config.
   */
  private resolveProvider(): NormalizedProviderConfig {
    const config = this.configService.getConfig();
    const active = this.configService.getActiveProvider();
    if (active?.base_url) {
      return active;
    }
    return {
      name: config.model.provider,
      base_url: config.model.base_url,
      api_key_env: config.model.api_key_env,
      api_key: config.model.api_key || (config.model.api_key_env.startsWith("sk-") ? config.model.api_key_env : process.env[config.model.api_key_env] ?? ""),
      request_timeout_seconds: config.model.request_timeout_seconds,
      stale_timeout_seconds: config.model.stale_timeout_seconds,
      models: {},
    };
  }

  /**
   * Resolves the output token cap for one provider call.
   *
   * @param model - Active model id being requested.
   * @param provider - Normalized provider configuration.
   * @returns Request fragment containing `max_tokens` when configured.
   * @usage Honors Hermes-style provider model budgets when the top-level model budget is unset.
   */
  private modelOutputBudget(model: string, provider: NormalizedProviderConfig): { readonly max_tokens?: number } {
    const config = this.configService.getConfig();
    const configured = config.model.max_tokens ?? provider.models[model]?.max_tokens ?? null;
    return typeof configured === "number" && Number.isFinite(configured) && configured > 0
      ? { max_tokens: configured }
      : {};
  }

  /**
   * Reads OpenAI-compatible SSE chunks and extracts content deltas.
   *
   * @param body - Fetch response body stream.
   * @returns Async stream of text deltas.
   * @usage Parses DeepSeek/OpenAI-compatible `data: {...}` events.
   */
  private async *readSseDeltas(body: ReadableStream<Uint8Array>): AsyncIterable<ModelStreamEvent> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";
    const toolCallBuffers = new Map<number, MutableToolCallBuffer>();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const data = trimmed.slice("data:".length).trim();
          if (data === "[DONE]") {
            return;
          }
          const parsed = JSON.parse(data) as OpenAICompatibleChunk;
          const choice = parsed.choices?.[0];
          const deltaPayload = choice?.delta;
          const delta = deltaPayload?.content ?? "";
          const reasoning = deltaPayload?.reasoning_content ?? deltaPayload?.reasoning ?? "";
          if (delta.length > 0) {
            yield { type: "delta", text: delta };
          }
          if (reasoning.length > 0) {
            yield { type: "reasoning", text: reasoning };
          }
          this.accumulateToolCallDeltas(toolCallBuffers, deltaPayload?.tool_calls ?? []);
          if (choice?.finish_reason === "tool_calls") {
            for (const toolCall of this.flushToolCalls(toolCallBuffers)) {
              yield { type: "tool_call", toolCall };
            }
          }
          if (choice?.finish_reason && choice.finish_reason !== "tool_calls") {
            for (const toolCall of this.flushToolCalls(toolCallBuffers)) {
              yield { type: "tool_call", toolCall };
            }
          }
        }
      }
    }
    for (const toolCall of this.flushToolCalls(toolCallBuffers)) {
      yield { type: "tool_call", toolCall };
    }
  }

  /**
   * Accumulates streaming tool call fragments by provider index.
   *
   * @param buffers - Mutable call buffers for the current response.
   * @param toolCalls - Provider delta fragments.
   * @returns Nothing.
   * @usage OpenAI-compatible streams often split function arguments across chunks.
   */
  private accumulateToolCallDeltas(
    buffers: Map<number, MutableToolCallBuffer>,
    toolCalls: readonly OpenAICompatibleToolCallDelta[],
  ): void {
    for (const call of toolCalls) {
      const index = call.index ?? 0;
      const current = buffers.get(index) ?? { id: call.id ?? `tool-${index}`, name: "", argumentsJson: "" };
      buffers.set(index, {
        id: call.id ?? current.id,
        name: `${current.name}${call.function?.name ?? ""}`,
        argumentsJson: `${current.argumentsJson}${call.function?.arguments ?? ""}`,
      });
    }
  }

  /**
   * Flushes accumulated tool calls and clears the response buffers.
   *
   * @param buffers - Mutable call buffers for the current response.
   * @returns Complete tool calls with non-empty names.
   * @usage Runtime receives tool calls only after streaming arguments are complete.
   */
  private flushToolCalls(buffers: Map<number, MutableToolCallBuffer>): readonly ModelToolCall[] {
    const calls = [...buffers.values()]
      .filter((call) => call.name.length > 0)
      .map((call) => ({
        id: call.id,
        name: call.name,
        argumentsJson: call.argumentsJson || "{}",
      }));
    buffers.clear();
    return calls;
  }

  /**
   * Converts non-streaming-like complete tool call deltas into executable calls.
   *
   * @param toolCalls - Provider tool call delta fragments.
   * @returns Complete tool calls found in this chunk.
   * @usage Retained for providers that emit complete calls in one chunk.
   */
  private parseToolCallDeltas(toolCalls: readonly OpenAICompatibleToolCallDelta[]): readonly ModelToolCall[] {
    return toolCalls
      .map((call, index) => ({
        id: call.id ?? `tool-${call.index ?? index}`,
        name: call.function?.name ?? "",
        argumentsJson: call.function?.arguments ?? "{}",
      }))
      .filter((call) => call.name.length > 0);
  }
}

/**
 * Describes the subset of an OpenAI-compatible streaming chunk we consume.
 *
 * @property choices - Streaming choices with assistant content deltas.
 * @usage Internal parsing type for `OpenAICompatibleModelProvider`.
 */
interface OpenAICompatibleChunk {
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly delta?: {
      readonly content?: string;
      readonly reasoning?: string;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly OpenAICompatibleToolCallDelta[];
    };
  }[];
}

/**
 * Describes the non-streaming completion shape used for intent analysis.
 *
 * @property choices - Provider choices with the assistant message content.
 * @usage OpenAICompatibleModelProvider reads this shape from `/chat/completions`.
 */
interface OpenAICompatibleCompletion {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string;
    };
  }[];
}

/**
 * Describes a streamed OpenAI-compatible tool call delta.
 *
 * @property id - Provider tool call id.
 * @property function - Function tool call name and JSON arguments.
 * @usage Internal parsing type for provider streaming chunks.
 */
interface OpenAICompatibleToolCallDelta {
  readonly index?: number;
  readonly id?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

/**
 * Describes a mutable accumulated tool call while streaming provider chunks arrive.
 *
 * @property id - Provider or generated tool call id.
 * @property name - Accumulated function name.
 * @property argumentsJson - Accumulated JSON argument string.
 * @usage Internal streaming parser state.
 */
interface MutableToolCallBuffer {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}
