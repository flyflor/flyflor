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

const ADAPTERS = new Map<ProtocolName, ProtocolAdapter>([
    ['anthropic', anthropicAdapter],
    ['bedrock', bedrockAdapter],
    ['cohere', cohereAdapter],
    ['gemini', geminiAdapter],
    ['ollama', ollamaAdapter],
    ['openai', openAIAdapter],
    ['responses', responsesAdapter],
]);

@Provide()
export class ProtocolClient extends FService {
    public stream(
        config: ModelOptions,
        messages: Message[],
        signal: AbortSignal,
        tools?: ToolDefinition[],
    ): ReadableStream<StreamEvent> {
        if (messages.length === 0) throw Error('Model request messages are missing');
        return new ReadableStream<StreamEvent>({
            start: async (controller) => {
                try {
                    await this.request(controller, config, messages, signal, tools);
                } catch (error) {
                    controller.error(error);
                }
            },
        });
    }

    private async request(
        controller: ReadableStreamDefaultController<StreamEvent>,
        config: ModelOptions,
        messages: Message[],
        signal: AbortSignal,
        tools?: ToolDefinition[],
    ): Promise<void> {
        const errors: Array<Record<string, unknown>> = [];
        for (const attempt of this.resolve(config.provider)) {
            const context: ProtocolContext = { config, messages, tools, ...attempt };
            const url = this.endpoint(config.baseUrl, attempt.spec.path, config.model);
            const response = await fetch(url, {
                method: 'POST',
                headers: this.headers(context),
                signal,
                body: JSON.stringify(attempt.adapter.body(context)),
            });
            if (!response.ok) {
                const body = await response.text();
                if (!this.fallbackStatus(response.status)) {
                    throw Object.assign(Error('Model provider request failed'), {
                        detail: { provider: config.provider, protocol: attempt.spec.name, url, status: response.status, body },
                    });
                }
                errors.push({ protocol: attempt.spec.name, url, status: response.status, body });
                continue;
            }
            const contentType = response.headers.get('content-type') ?? '';
            if (this.jsonResponse(attempt.spec, contentType)) {
                if (attempt.spec.json !== true) {
                    errors.push({ protocol: attempt.spec.name, url, status: response.status, contentType });
                    continue;
                }
                const text = this.responseText(await response.json());
                if (text.length > 0) controller.enqueue({ type: 'text_delta', text });
                controller.enqueue({ type: 'done', stopReason: 'stop' });
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
            return;
        }
        throw Object.assign(Error(this.failure(config.provider, errors)), {
            detail: { provider: config.provider, errors },
        });
    }

    public resolve(provider: string): ProtocolAttempt[] {
        const key = provider.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
        if (key === 'anthropic') return [this.attempt({ name: 'anthropic', path: '/v1/messages', auth: 'anthropic', version: '2023-06-01' })];
        if (key === 'google' || key === 'gemini') return [this.attempt({ name: 'gemini', path: '/v1beta/models/{model}:streamGenerateContent?alt=sse', auth: 'google' })];
        if (key === 'aws' || key === 'bedrock') return [this.attempt({ name: 'bedrock', path: '/model/{model}/converse-stream', auth: 'bearer', jsonStream: true })];
        if (key === 'cohere') return [this.attempt({ name: 'cohere', path: '/v2/chat', auth: 'bearer' })];
        if (key === 'ollama') return [this.attempt({ name: 'ollama', path: '/api/chat', auth: 'optional', jsonStream: true })];
        if (key === 'openai') {
            return [
                this.attempt({ name: 'responses', path: '/v1/responses', auth: 'bearer', json: true }),
                this.attempt({ name: 'openai', path: '/v1/chat/completions', auth: 'bearer' }),
            ];
        }
        if (key === 'deepseek') {
            return [
                this.attempt({ name: 'openai', path: '/chat/completions', auth: 'bearer' }),
                this.attempt({ name: 'openai', path: '/v1/chat/completions', auth: 'bearer' }),
            ];
        }
        const auth = key === 'vllm' || key === 'lmstudio' ? 'optional' : 'bearer';
        return [this.attempt({ name: 'openai', path: '/v1/chat/completions', auth })];
    }

    private attempt(spec: ProtocolSpec): ProtocolAttempt {
        const adapter = ADAPTERS.get(spec.name);
        if (adapter === undefined) throw Error(`Unsupported model protocol: ${spec.name}`);
        return { spec, adapter };
    }

    private state(): ProtocolState {
        return {
            buffer: '',
            finished: false,
            toolCallsByIndex: new Map(),
            toolCallsById: new Map(),
            nextToolIndex: 0,
        };
    }

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

    private endpoint(baseUrl: string, path: string, model: string): string {
        if (/^https?:\/\//.test(path)) return path.replaceAll('{model}', encodeURIComponent(model));
        const base = baseUrl.replace(/\/+$/, '');
        let resolved = path.replaceAll('{model}', encodeURIComponent(model));
        if (base.endsWith('/v1') && resolved.startsWith('/v1/')) resolved = resolved.slice(3);
        return base + (resolved.startsWith('/') ? '' : '/') + resolved;
    }

    private fallbackStatus(status: number): boolean {
        return [400, 404, 405, 415, 422, 501].includes(status);
    }

    private jsonResponse(spec: ProtocolSpec, contentType: string): boolean {
        return spec.jsonStream !== true && contentType.toLowerCase().includes('application/json');
    }

    private responseText(json: unknown): string {
        const root = json as { output_text?: unknown; output?: unknown };
        if (typeof root.output_text === 'string') return root.output_text;
        const parts: string[] = [];
        if (Array.isArray(root.output)) {
            for (const output of root.output) {
                const content = (output as { content?: unknown }).content;
                if (!Array.isArray(content)) continue;
                for (const item of content) {
                    const text = (item as { text?: unknown }).text;
                    if (typeof text === 'string') parts.push(text);
                }
            }
        }
        if (parts.length === 0) throw Error('Responses JSON did not include text');
        return parts.join('');
    }

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
        throw Error(context.spec.terminal ?? 'Model provider stream ended without a terminal event');
    }

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

    private failure(provider: string, errors: Array<Record<string, unknown>>): string {
        if (errors.length === 0) return 'Model provider protocol matching failed';
        return `Model provider protocol matching failed (${provider}): ${errors.map((error) => JSON.stringify(error)).join(' | ')}`;
    }
}
