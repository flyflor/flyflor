import { FService, Provide } from '@/core';
import type { Message, StreamEvent, ToolDefinition } from '../types';
import { anthropicAdapter } from './anthropic';
import { bedrockAdapter } from './bedrock';
import { cohereAdapter } from './cohere';
import { geminiAdapter } from './gemini';
import { ollamaAdapter } from './ollama';
import { openAIAdapter } from './openai';
import { responsesAdapter } from './responses';
import type { ByteReader, ModelOptions, ProtocolAdapter, ProtocolAttempt, ProtocolContext, ProtocolName, ProtocolSpec, ProtocolState } from './types';

/** ZH: ProtocolClient.resolve 使用的协议名到线适配器注册表。 EN: Protocol name to wire adapter registry for ProtocolClient.resolve. */
const ADAPTERS = new Map<ProtocolName, ProtocolAdapter>([
    ['anthropic', anthropicAdapter],
    ['bedrock', bedrockAdapter],
    ['cohere', cohereAdapter],
    ['gemini', geminiAdapter],
    ['ollama', ollamaAdapter],
    ['openai', openAIAdapter],
    ['responses', responsesAdapter],
]);

/** ZH: fetch 前的内部 UTF-8 JSON body 安全上限（512 KiB）。 EN: Internal UTF-8 JSON body safety limit before fetch (512 KiB). */
const MAX_REQUEST_BODY_BYTES = 512 * 1024;

/** ZH: 将每个 provider 映射到唯一线协议与 endpoint。 EN: Maps each provider to one exact wire protocol and endpoint. */
@Provide()
export class ProtocolClient extends FService {
    /** ZH: 打开一个不含恢复分支的严格 provider stream。 EN: Opens one strict provider stream without recovery branches. */
    public stream(
        config: ModelOptions,
        messages: Message[],
        signal: AbortSignal,
        tools?: ToolDefinition[],
    ): ReadableStream<StreamEvent> {
        if (messages.length === 0) throw Error('Model request messages are missing');
        return new ReadableStream<StreamEvent>({
            start: (controller) => this.request(controller, config, messages, signal, tools),
        });
    }

    /** ZH: 执行唯一已配置 provider attempt。 EN: Executes the single configured provider attempt. */
    private async request(
        controller: ReadableStreamDefaultController<StreamEvent>,
        config: ModelOptions,
        messages: Message[],
        signal: AbortSignal,
        tools?: ToolDefinition[],
    ): Promise<void> {
        const attempt = this.resolve(config.provider);
        if (!attempt.adapter.tools && this.usesTools(messages, tools)) {
            throw Error(`Model protocol does not support tools: ${attempt.spec.name}`);
        }
        const context: ProtocolContext = { config, messages, tools, ...attempt };
        const url = this.endpoint(config.baseUrl, attempt.spec.path, config.model);
        const body = JSON.stringify(attempt.adapter.body(context));
        const requestBytes = Buffer.byteLength(body);
        if (requestBytes > MAX_REQUEST_BODY_BYTES) {
            throw Object.assign(Error('Model provider request body exceeds limit'), {
                detail: {
                    provider: config.provider,
                    protocol: attempt.spec.name,
                    requestBytes,
                    maxRequestBytes: MAX_REQUEST_BODY_BYTES,
                },
            });
        }
        const response = await fetch(url, {
            method: 'POST',
            headers: this.headers(context),
            signal,
            body,
        });
        if (!response.ok) {
            throw Object.assign(Error('Model provider request failed'), {
                detail: { provider: config.provider, protocol: attempt.spec.name, url, requestBytes, status: response.status, body: await response.text() },
            });
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (this.jsonResponse(attempt.spec, contentType)) {
            if (attempt.spec.json !== true || attempt.adapter.parseJson === undefined) throw Error(`Unexpected JSON response: ${attempt.spec.name}`);
            const result = attempt.adapter.parseJson(await response.json());
            if (result.text.length > 0) controller.enqueue({ type: 'text_delta', text: result.text });
            controller.enqueue({ type: 'done', stopReason: result.stopReason });
            controller.close();
            return;
        }
        const reader = response.body?.getReader();
        if (reader === undefined) {
            throw Object.assign(Error('Model provider returned no response body'), {
                detail: { provider: config.provider, protocol: attempt.spec.name, url },
            });
        }
        await this.read(controller, reader, context);
    }

    /** ZH: 解析唯一受支持的 provider convention。 EN: Resolves exactly one supported provider convention. */
    public resolve(provider: string): ProtocolAttempt {
        const key = provider.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
        if (key === 'anthropic') return this.attempt({ name: 'anthropic', path: '/v1/messages', auth: 'anthropic', version: '2023-06-01' });
        if (key === 'google' || key === 'gemini') return this.attempt({ name: 'gemini', path: '/v1beta/models/{model}:streamGenerateContent?alt=sse', auth: 'google' });
        if (key === 'aws' || key === 'bedrock') return this.attempt({ name: 'bedrock', path: '/model/{model}/converse-stream', auth: 'bearer', jsonStream: true });
        if (key === 'cohere') return this.attempt({ name: 'cohere', path: '/v2/chat', auth: 'bearer' });
        if (key === 'ollama') return this.attempt({ name: 'ollama', path: '/api/chat', auth: 'optional', jsonStream: true });
        if (key === 'openai') return this.attempt({ name: 'openai', path: '/v1/chat/completions', auth: 'bearer' });
        if (key === 'responses' || key === 'openairesponses') return this.attempt({ name: 'responses', path: '/v1/responses', auth: 'bearer', json: true });
        if (key === 'deepseek') return this.attempt({ name: 'openai', path: '/chat/completions', auth: 'bearer' });
        if (key === 'vllm' || key === 'lmstudio') return this.attempt({ name: 'openai', path: '/v1/chat/completions', auth: 'optional' });
        throw Error(`Unsupported model provider: ${provider}`);
    }

    /** ZH: 将一个协议 spec 绑定到必需 adapter。 EN: Binds one protocol spec to its required adapter. */
    private attempt(spec: ProtocolSpec): ProtocolAttempt {
        const adapter = ADAPTERS.get(spec.name);
        if (adapter === undefined) throw Error(`Unsupported model protocol: ${spec.name}`);
        return { spec, adapter };
    }

    /** ZH: 为一次响应创建隔离 parser state。 EN: Creates isolated parser state for one response. */
    private state(): ProtocolState {
        return {
            buffer: '',
            finished: false,
            toolCallsByIndex: new Map(),
            toolCallsById: new Map(),
            nextToolIndex: 0,
        };
    }

    /** ZH: 为一个 convention 构造精确认证 headers。 EN: Builds exact authentication headers for one convention. */
    private headers(context: ProtocolContext): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (context.spec.auth === 'none') return headers;
        const apiKey = context.config.apiKeyEnv ? process.env[context.config.apiKeyEnv] : undefined;
        if (!apiKey && context.spec.auth === 'optional') return headers;
        if (!apiKey) {
            throw Object.assign(Error('Model provider API key is missing'), {
                detail: { provider: context.config.provider, protocol: context.spec.name, apiKeyEnv: context.config.apiKeyEnv },
            });
        }
        if (context.spec.auth === 'anthropic') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = context.spec.version!;
        } else if (context.spec.auth === 'google') {
            headers['x-goog-api-key'] = apiKey;
        } else {
            headers.Authorization = `Bearer ${apiKey}`;
        }
        return headers;
    }

    /** ZH: 解析精确配置的 endpoint。 EN: Resolves the exact configured endpoint. */
    private endpoint(baseUrl: string, path: string, model: string): string {
        if (/^https?:\/\//.test(path)) return path.replaceAll('{model}', encodeURIComponent(model));
        const base = baseUrl.replace(/\/+$/, '');
        let resolved = path.replaceAll('{model}', encodeURIComponent(model));
        if (base.endsWith('/v1') && resolved.startsWith('/v1/')) resolved = resolved.slice(3);
        return base + (resolved.startsWith('/') ? '' : '/') + resolved;
    }

    /** ZH: 检测声明的非流式 JSON 响应。 EN: Detects a declared non-streaming JSON response. */
    private jsonResponse(spec: ProtocolSpec, contentType: string): boolean {
        return spec.jsonStream !== true && contentType.toLowerCase().includes('application/json');
    }

    /** ZH: 报告一次请求是否包含工具定义或 replay。 EN: Reports whether one request contains tool definitions or replay. */
    private usesTools(messages: Message[], tools?: ToolDefinition[]): boolean {
        return (tools?.length ?? 0) > 0
            || messages.some((message) => message.role === 'tool' || ('toolCalls' in message && message.toolCalls.length > 0));
    }

    /** ZH: 读取响应字节直到协议终态事件。 EN: Reads response bytes until one protocol terminal event. */
    private async read(
        controller: ReadableStreamDefaultController<StreamEvent>,
        reader: ByteReader,
        context: ProtocolContext,
    ): Promise<void> {
        const decoder = new TextDecoder();
        const state = this.state();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            state.buffer += decoder.decode(value, { stream: true });
            await this.lines(controller, reader, state, context.adapter);
            if (state.finished) return;
        }
        state.buffer += decoder.decode();
        if (state.buffer.trim().length > 0) {
            await this.lines(controller, reader, state, context.adapter, true);
            if (state.finished) return;
        }
        throw Error('Model provider stream ended without a terminal event');
    }

    /** ZH: 按稳定顺序解析完整响应行。 EN: Parses complete response lines in stable order. */
    private async lines(
        controller: ReadableStreamDefaultController<StreamEvent>,
        reader: ByteReader,
        state: ProtocolState,
        adapter: ProtocolAdapter,
        flush = false,
    ): Promise<void> {
        const lines = state.buffer.split('\n');
        state.buffer = flush ? '' : (lines.pop() ?? '');
        for (const line of lines) {
            if (!adapter.parse(controller, line, state)) continue;
            state.finished = true;
            controller.close();
            await reader.cancel();
            return;
        }
    }
}
