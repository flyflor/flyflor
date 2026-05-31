import { randomUUID } from "node:crypto";
import { Component, Inject } from "../di";
import { ConfigService } from "../config/config.service";
import type { ContextIntentModelRequest, ContextMessage } from "../context";
import type { MemoryRecallResult } from "../memory";
import type { NormalizedProviderConfig } from "../config/config.types";
import type { ToolDefinition } from "../tools";

export interface ModelRequest {
  readonly model: string;
  readonly messages: readonly ContextMessage[];
  readonly userInput: string;
  readonly recall: readonly MemoryRecallResult[];
  readonly tools?: readonly ToolDefinition[];
}

export interface ModelStreamEvent {
  readonly type: "delta" | "reasoning" | "tool_call" | "final";
  readonly text?: string;
  readonly toolCall?: ModelToolCall;
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export interface ModelProvider {
  analyzeIntent?(request: ContextIntentModelRequest): Promise<string>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

// Endpoint resolution cache keyed by base_url
interface EndpointCache {
  chat: string | null;
  responses: string | null;
}
const endpointCache = new Map<string, EndpointCache>();

@Component()
export class OpenAICompatibleModelProvider implements ModelProvider {
  @Inject(ConfigService) private configService!: ConfigService;

  public constructor(configService?: ConfigService) {
    if (configService) this.configService = configService;
  }

  // -- public API -----------------------------------------------------------

  public async analyzeIntent(request: ContextIntentModelRequest): Promise<string> {
    const provider = this.resolveProvider();
    if (!provider.api_key) throw new Error(`Missing API key for provider ${provider.name}`);

    const endpoint = await this.resolveChatEndpoint(provider);
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.api_key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: this.normalizeMessages(request.messages),
        stream: false,
        temperature: 0,
        max_tokens: 2400,
      }),
      signal: AbortSignal.timeout(provider.request_timeout_seconds * 1000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Provider ${provider.name} intent failed ${resp.status}: ${text.slice(0, 800)}`);
    }
    const parsed = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return parsed.choices?.[0]?.message?.content ?? "";
  }

  public async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const provider = this.resolveProvider();
    if (!provider.api_key) throw new Error(`Missing API key for provider ${provider.name}`);

    const endpoint = await this.resolveChatEndpoint(provider);
    const body = {
      model: request.model,
      messages: this.normalizeMessages(request.messages),
      ...(request.tools && request.tools.length > 0 ? { tools: this.formatTools(request.tools), tool_choice: "auto" } : {}),
      stream: true,
      ...this.modelOutputBudget(request.model, provider),
    };
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.api_key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(provider.request_timeout_seconds * 1000),
    });

    // 404/405 → endpoint doesn't support streaming, fall back to responses
    if (resp.status === 404 || resp.status === 405) {
      yield* this.streamViaResponses(request, provider);
      return;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Provider ${provider.name} failed ${resp.status}: ${text.slice(0, 800)}`);
    }
    if (!resp.body) {
      yield* this.streamViaResponses(request, provider);
      return;
    }

    let finalText = "";
    for await (const event of this.readSseDeltas(resp.body)) {
      if (event.type === "delta" && event.text) finalText += event.text;
      yield event;
    }
    if (finalText) yield { type: "final", text: finalText };
  }

  // -- fallback: non-streaming -------------------------------------------------

  private async *streamViaResponses(
    request: ModelRequest,
    provider: NormalizedProviderConfig,
  ): AsyncIterable<ModelStreamEvent> {
    const endpoint = await this.resolveResponsesEndpoint(provider);
    const body = {
      model: request.model,
      messages: this.normalizeMessages(request.messages),
      ...(request.tools && request.tools.length > 0 ? { tools: this.formatTools(request.tools) } : {}),
      stream: false,
      ...this.modelOutputBudget(request.model, provider),
    };
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.api_key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(provider.request_timeout_seconds * 1000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Provider ${provider.name} responses failed ${resp.status}: ${text.slice(0, 800)}`);
    }
    const parsed = await resp.json() as {
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    };
    const msg = parsed.choices?.[0]?.message;
    const content = msg?.content ?? "";
    if (content) {
      yield { type: "delta", text: content };
      yield { type: "final", text: content };
    }
    for (const tc of msg?.tool_calls ?? []) {
      yield { type: "tool_call", toolCall: { id: tc.id, name: tc.function.name, argumentsJson: tc.function.arguments } };
    }
  }

  // -- endpoint resolution -----------------------------------------------------

  /** Probes candidate URLs and caches the first working chat-completions endpoint. */
  private async resolveChatEndpoint(provider: NormalizedProviderConfig): Promise<string> {
    const cache = this.getOrCreateCache(provider.base_url);
    if (cache.chat) return cache.chat;

    const candidates = this.buildEndpointCandidates(provider.base_url, ["v1/chat/completions", "chat/completions"]);
    for (const url of candidates) {
      if (await this.probeEndpoint(url, provider)) {
        cache.chat = url;
        return url;
      }
    }
    cache.chat = candidates[0]!;
    return cache.chat;
  }

  /** Probes candidate URLs and caches the first working responses endpoint. */
  private async resolveResponsesEndpoint(provider: NormalizedProviderConfig): Promise<string> {
    const cache = this.getOrCreateCache(provider.base_url);
    if (cache.responses) return cache.responses;

    const candidates = this.buildEndpointCandidates(provider.base_url, ["v1/responses", "responses", "v1/chat/completions", "chat/completions"]);
    for (const url of candidates) {
      if (await this.probeEndpoint(url, provider)) {
        cache.responses = url;
        return url;
      }
    }
    cache.responses = candidates[0]!;
    return cache.responses;
  }

  private getOrCreateCache(baseUrl: string): EndpointCache {
    const key = baseUrl.replace(/\/+$/, "");
    const existing = endpointCache.get(key);
    if (existing) return existing;
    const entry: EndpointCache = { chat: null, responses: null };
    endpointCache.set(key, entry);
    return entry;
  }

  private buildEndpointCandidates(baseUrl: string, paths: string[]): string[] {
    const base = baseUrl.replace(/\/+$/, "");
    return paths.map((p) => `${base}/${p}`);
  }

  /** Quick POST probe: endpoint exists if it returns anything other than 404/405. */
  private async probeEndpoint(url: string, provider: NormalizedProviderConfig): Promise<boolean> {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.api_key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "ping", messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
        signal: AbortSignal.timeout(8000),
      });
      return resp.status !== 404 && resp.status !== 405;
    } catch {
      return false;
    }
  }

  // -- helpers ------------------------------------------------------------------

  private resolveProvider(): NormalizedProviderConfig {
    const config = this.configService.getConfig();
    const active = this.configService.getActiveProvider();
    if (active?.base_url) return active;
    return {
      name: config.model.provider,
      base_url: config.model.base_url,
      api_key_env: config.model.api_key_env,
      api_key: config.model.api_key || (config.model.api_key_env ? process.env[config.model.api_key_env] ?? "" : ""),
      request_timeout_seconds: config.model.request_timeout_seconds,
      stale_timeout_seconds: config.model.stale_timeout_seconds,
      models: {},
    };
  }

  private normalizeMessages(messages: readonly ContextMessage[]): Array<{ role: string; content: string }> {
    return messages.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }));
  }

  private formatTools(tools: readonly ToolDefinition[]) {
    return tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.schema } }));
  }

  private modelOutputBudget(model: string, provider: NormalizedProviderConfig): { readonly max_tokens?: number } {
    const config = this.configService.getConfig();
    const configured = config.model.max_tokens ?? provider.models[model]?.max_tokens ?? null;
    return typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? { max_tokens: configured } : {};
  }

  // -- SSE parser ---------------------------------------------------------------

  private async *readSseDeltas(body: ReadableStream<Uint8Array>): AsyncIterable<ModelStreamEvent> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";
    const toolBufs = new Map<number, { id: string; name: string; args: string }>();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
                finish_reason?: string;
              }>;
            };
            const choice = parsed.choices?.[0];
            const d = choice?.delta;
            if (d?.content) yield { type: "delta", text: d.content };
            if (d?.reasoning_content || d?.reasoning) yield { type: "reasoning", text: d.reasoning_content ?? d.reasoning ?? "" };
            for (const tc of d?.tool_calls ?? []) {
              const existing = toolBufs.get(tc.index);
              toolBufs.set(tc.index, {
                id: tc.id ?? existing?.id ?? randomUUID(),
                name: tc.function?.name ?? existing?.name ?? "",
                args: (existing?.args ?? "") + (tc.function?.arguments ?? ""),
              });
            }
            if (choice?.finish_reason) {
              for (const buf of toolBufs.values()) {
                if (buf.id) yield { type: "tool_call", toolCall: { id: buf.id, name: buf.name, argumentsJson: buf.args || "{}" } };
              }
              toolBufs.clear();
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    }
    for (const buf of toolBufs.values()) {
      if (buf.id) yield { type: "tool_call", toolCall: { id: buf.id, name: buf.name, argumentsJson: buf.args || "{}" } };
    }
  }
}
