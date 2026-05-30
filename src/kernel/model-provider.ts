import { Component } from "../di";
import { ConfigService } from "../config/config.service";
import type { ContextMessage } from "../context";
import type { MemoryRecallResult } from "../memory";
import type { NormalizedProviderConfig } from "../config/config.types";

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
}

/**
 * Describes one streamed model event.
 *
 * @property type - Event kind emitted by the provider.
 * @property text - Optional assistant text delta or final text.
 * @usage Runtime turns provider events into SignalBus and socket events.
 */
export interface ModelStreamEvent {
  readonly type: "delta" | "final";
  readonly text: string;
}

/**
 * Describes the model adapter contract.
 *
 * @param request - Model request containing context and current user input.
 * @returns Async stream of model events.
 * @usage Real providers and mock providers implement this interface.
 */
export interface ModelProvider {
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
        stream: true,
        ...(this.configService.getConfig().model.max_tokens ? { max_tokens: this.configService.getConfig().model.max_tokens } : {}),
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
    for await (const delta of this.readSseDeltas(response.body)) {
      finalText += delta;
      yield { type: "delta", text: delta };
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
   * Reads OpenAI-compatible SSE chunks and extracts content deltas.
   *
   * @param body - Fetch response body stream.
   * @returns Async stream of text deltas.
   * @usage Parses DeepSeek/OpenAI-compatible `data: {...}` events.
   */
  private async *readSseDeltas(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";
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
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta.length > 0) {
            yield delta;
          }
        }
      }
    }
  }
}

/**
 * Deterministic provider used by v1 scenario tests and local socket smoke checks.
 *
 * @usage This provider exercises the full runtime path without external LLM credentials.
 */
@Component()
export class MockModelProvider implements ModelProvider {
  /**
   * Streams a deterministic answer based on current input and recalled memory.
   *
   * @param request - Model request containing no-session context and memory recall.
   * @returns Async iterable with delta and final events.
   * @usage Tests assert continuity through this provider while avoiding network calls.
   */
  public async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const recalled = request.recall.map((item) => item.chunk.content).join(" | ");
    const answer = this.answerFor(request.userInput, recalled);
    const midpoint = Math.max(1, Math.floor(answer.length / 2));
    yield { type: "delta", text: answer.slice(0, midpoint) };
    yield { type: "delta", text: answer.slice(midpoint) };
    yield { type: "final", text: answer };
  }

  /**
   * Creates a stable assistant answer for a user input.
   *
   * @param userInput - Current user message.
   * @param recalled - Concatenated memory recall text.
   * @returns Final assistant answer.
   * @usage Keeps scenario assertions deterministic.
   */
  private answerFor(userInput: string, recalled: string): string {
    const projectCode = this.extractProjectCode(userInput) ?? this.extractProjectCode(recalled);
    if (/项目代号|project code|codename/i.test(userInput) && projectCode) {
      return `我记得你的项目代号是 ${projectCode}。`;
    }
    if (recalled.length > 0) {
      return `已结合本地记忆处理：${userInput}\n\n召回：${recalled}`;
    }
    return `已处理：${userInput}`;
  }

  /**
   * Extracts a simple project code fact from text.
   *
   * @param text - User input or recalled memory text.
   * @returns Extracted project code, or undefined when absent.
   * @usage Supports the no-session continuity scenario.
   */
  private extractProjectCode(text: string): string | undefined {
    const match = text.match(/(?:项目代号(?:是|为)?|project code(?: is)?|codename(?: is)?)\s*[:：]?\s*([a-zA-Z0-9_.-]+)/i);
    return match?.[1];
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
    readonly delta?: {
      readonly content?: string;
    };
  }[];
}
