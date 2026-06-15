import { type FModelConfiguration, FModelProtocolName } from '@/config';
import { anthropicMessagesAdapter, awsBedrockConverseAdapter, cohereChatAdapter, googleGeminiGenerateContentAdapter, huggingFaceAdapter, lmStudioAdapter, ollamaAdapter, openAIChatCompletionsAdapter, openAIResponsesAdapter, vllmAdapter } from './protocols';
import type { AgentMemory } from '@/agent/memory';
import type { IntelligenceEvent, IntelligenceToolDefinition, LlmByteStreamReader, ProtocolAdapter, ProtocolBuildContext, ProtocolStreamState } from './types';

/**
 * Protocol adapters are plain composition objects. The factory owns transport, adapters own wire shapes.
 */
const PROTOCOLS = new Map<FModelProtocolName, ProtocolAdapter>([
    [FModelProtocolName.AnthropicMessages, anthropicMessagesAdapter],
    [FModelProtocolName.OpenAIResponses, openAIResponsesAdapter],
    [FModelProtocolName.GoogleGeminiGenerateContent, googleGeminiGenerateContentAdapter],
    [FModelProtocolName.AWSBedrockConverse, awsBedrockConverseAdapter],
    [FModelProtocolName.CohereChat, cohereChatAdapter],
    [FModelProtocolName.HuggingFace, huggingFaceAdapter],
    [FModelProtocolName.Ollama, ollamaAdapter],
    [FModelProtocolName.VLLM, vllmAdapter],
    [FModelProtocolName.LMStudio, lmStudioAdapter],
    [FModelProtocolName.OpenAIChatCompletions, openAIChatCompletionsAdapter],
]);

/**
 * Creates a fresh per-request streaming-accumulation state.
 * The two maps route interleaved provider `tool_calls[]` deltas to the right call across lines.
 */
export const createProtocolStreamState = (): ProtocolStreamState => ({
    buffer: '',
    finished: false,
    toolCallsByIndex: new Map(),
    toolCallsById: new Map(),
    nextToolIndex: 0,
});

/**
 * Creates a cancellable structured event stream for one provider-facing LLM request.
 * Text turns yield `text_delta` events; tool turns also yield `toolcall_*` events. A terminal `done`
 * event is always emitted before the stream closes on success.
 */
export const createIntelligenceTurnStream = (
    config: FModelConfiguration,
    messages: AgentMemory[],
    signal: AbortSignal,
    tools?: IntelligenceToolDefinition[],
): ReadableStream<IntelligenceEvent> => {
    if (messages.length === 0) {
        throw Error('LLM provider request messages are missing');
    }
    return new ReadableStream<IntelligenceEvent>({
        start: (controller) => start(controller, config, messages, signal, tools),
    });
};

async function start(controller: ReadableStreamDefaultController<IntelligenceEvent>, config: FModelConfiguration, messages: AgentMemory[], signal: AbortSignal, tools?: IntelligenceToolDefinition[]): Promise<void> {
    try {
        await requestLlm(controller, config, messages, signal, tools);
    } catch (error) {
        controller.error(error);
    }
}

async function requestLlm(controller: ReadableStreamDefaultController<IntelligenceEvent>, config: FModelConfiguration, messages: AgentMemory[], signal: AbortSignal, tools?: IntelligenceToolDefinition[]): Promise<void> {
    const errors: Array<Record<string, unknown>> = [];
    for (const protocol of protocols(config)) {
        if (protocol.enabled === false) continue;
        const adapter = PROTOCOLS.get(protocol.name);
        if (adapter === undefined) {
            throw Object.assign(Error('Unsupported LLM protocol'), { detail: { protocol: protocol.name } });
        }
        const context: ProtocolBuildContext = { config, messages, protocol, adapter, model: config.model || config.default, maxTokens: config.maxTokens, tools };
        const body = adapter.body(context);
        for (const url of urls(context)) {
            // Each URL is a full protocol attempt; retry only when the status usually means "wrong endpoint shape".
            const response = await fetch(url, {
                method: 'POST',
                headers: headers(context),
                signal,
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const body = await response.text();
                if (!canTryNextProtocol(response.status)) {
                    throw Object.assign(Error('LLM provider request failed'), {
                        detail: { provider: config.provider, protocol: protocol.name, url, status: response.status, body },
                    });
                }
                errors.push({ protocol: protocol.name, url, status: response.status, body });
                continue;
            }
            const contentType = response.headers.get('content-type') ?? '';
            if (isJsonResponse(context, contentType)) {
                if (protocol.acceptsJsonResponse !== true) {
                    errors.push({ protocol: protocol.name, url, status: response.status, contentType });
                    break;
                }
                const text = responsesText(await response.json());
                if (text.length > 0) controller.enqueue({ type: 'text_delta', text });
                controller.enqueue({ type: 'done', stopReason: 'stop' });
                controller.close();
                return;
            }
            const reader = response.body?.getReader();
            if (reader === undefined) {
                throw Object.assign(Error('LLM provider returned no response body'), {
                    detail: { provider: config.provider, protocol: protocol.name, url },
                });
            }
            await readStreamingContent(controller, reader, context);
            return;
        }
    }
    throw Object.assign(Error('LLM provider protocol matching failed'), {
        detail: { provider: config.provider, errors },
    });
}

function protocols(config: FModelConfiguration) {
    if (config.protocols.length === 0) throw Error('LLM provider protocols are missing');
    return config.protocols;
}

function headers(context: ProtocolBuildContext): Record<string, string> {
    // Auth stays protocol-local because compatible providers differ on header names.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKeyEnv = context.protocol.apiKeyEnv ?? context.config.apiKeyEnv;
    if (context.protocol.auth === 'none') return headers;
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
    if ((apiKey === undefined || apiKey.length === 0) && context.protocol.auth === 'optionalBearer') return headers;
    if (apiKey === undefined || apiKey.length === 0) {
        throw Object.assign(Error('LLM provider API key is missing'), {
            detail: { provider: context.config.provider, protocol: context.protocol.name, apiKeyEnv },
        });
    }
    if (context.protocol.auth === 'anthropic') {
        headers['x-api-key'] = apiKey;
        if (context.protocol.version === undefined || context.protocol.version.length === 0) {
            throw Object.assign(Error('LLM provider protocol version is missing'), {
                detail: { provider: context.config.provider, protocol: context.protocol.name },
            });
        }
        headers['anthropic-version'] = context.protocol.version;
        return headers;
    }
    if (context.protocol.auth === 'google') {
        headers['x-goog-api-key'] = apiKey;
        return headers;
    }
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
}

function urls(context: ProtocolBuildContext): string[] {
    const baseUrl = (context.protocol.baseUrl ?? context.config.baseUrl).replace(/\/+$/, '');
    const path = replaceModel(context.protocol.path, context.model);
    const urls = [joinEndpoint(baseUrl, path)];
    if (context.protocol.usesV1Fallback === true && !baseUrl.endsWith('/v1')) {
        urls.push(joinEndpoint(baseUrl + '/v1', path));
    }
    return [...new Set(urls)];
}

function joinEndpoint(baseUrl: string, path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return baseUrl + (path.startsWith('/') ? '' : '/') + path;
}

function replaceModel(path: string, model: string): string {
    return path.replaceAll('{model}', encodeURIComponent(model));
}

function canTryNextProtocol(status: number): boolean {
    return [400, 404, 405, 415, 422, 501].includes(status);
}

function isJsonResponse(context: ProtocolBuildContext, contentType: string): boolean {
    if (context.protocol.acceptsJsonStream === true) return false;
    return contentType.toLowerCase().includes('application/json');
}

function responsesText(json: unknown): string {
    // Responses non-streaming JSON is folded back into the same text event contract.
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
    if (parts.length > 0) return parts.join('');
    throw Error('LLM provider Responses JSON did not include text');
}

async function readStreamingContent(controller: ReadableStreamDefaultController<IntelligenceEvent>, reader: LlmByteStreamReader, context: ProtocolBuildContext): Promise<void> {
    // Providers may split UTF-8 bytes and SSE/JSON lines across chunks, so decoding is buffered.
    const decoder = new TextDecoder();
    const state = createProtocolStreamState();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        state.buffer += decoder.decode(value, { stream: true });
        await drainStreamingLines(controller, reader, state, context.adapter);
        if (state.finished) return;
    }
    state.buffer += decoder.decode();
    if (state.buffer.trim().length > 0) {
        await drainStreamingLines(controller, reader, state, context.adapter, true);
        if (state.finished) return;
    }
    throw Error(context.protocol.missingTerminalMessage ?? 'LLM provider stream ended without a terminal event');
}

async function drainStreamingLines(controller: ReadableStreamDefaultController<IntelligenceEvent>, reader: LlmByteStreamReader, state: ProtocolStreamState, adapter: ProtocolAdapter, flush = false): Promise<void> {
    const lines = state.buffer.split('\n');
    state.buffer = flush ? '' : (lines.pop() ?? '');
    for (const line of lines) {
        if (adapter.parseLine(controller, line, state)) {
            state.finished = true;
            controller.close();
            await reader.cancel();
            return;
        }
    }
}
