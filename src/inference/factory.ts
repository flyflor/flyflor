import { type FModelConfiguration, FModelProtocolName } from '@/configuration';
import { anthropicMessagesAdapter, awsBedrockConverseAdapter, cohereChatAdapter, googleGeminiGenerateContentAdapter, huggingFaceAdapter, lmStudioAdapter, ollamaAdapter, openAIChatCompletionsAdapter, openAIResponsesAdapter, vllmAdapter } from './protocols';
import type { InferenceEvent, InferenceToolDefinition, LlmByteStreamReader, ProtocolAdapter, ProtocolBuildContext, ProtocolStreamState, ProviderMessage } from './types';

export interface InferenceRequestLimits {
    requestTimeoutMs: number;
    staleTimeoutMs: number;
}

class InferenceRequestControl {
    private readonly controller = new AbortController();
    private readonly externalAbort: () => void;
    private requestTimer?: ReturnType<typeof setTimeout>;
    private staleTimer?: ReturnType<typeof setTimeout>;
    private reader?: LlmByteStreamReader;
    private consumerCancelled = false;

    constructor(
        private readonly external: AbortSignal,
        private readonly limits: InferenceRequestLimits,
    ) {
        this.externalAbort = () => this.abort(this.external.reason ?? Error('Inference request aborted'));
        if (external.aborted) this.externalAbort();
        else external.addEventListener('abort', this.externalAbort, { once: true });
        this.requestTimer = this.timer(limits.requestTimeoutMs, 'Inference request timed out');
        this.activity();
    }

    public get signal(): AbortSignal {
        return this.controller.signal;
    }

    public bind(reader: LlmByteStreamReader): void {
        this.reader = reader;
        if (this.signal.aborted) void reader.cancel(this.signal.reason).catch(() => undefined);
    }

    public activity(): void {
        if (this.signal.aborted) return;
        if (this.staleTimer) clearTimeout(this.staleTimer);
        this.staleTimer = this.timer(this.limits.staleTimeoutMs, 'Inference provider stream became stale');
    }

    public close(): void {
        if (this.requestTimer) clearTimeout(this.requestTimer);
        if (this.staleTimer) clearTimeout(this.staleTimer);
        this.external.removeEventListener('abort', this.externalAbort);
        this.reader = undefined;
    }

    public cancel(reason: unknown): void {
        this.consumerCancelled = true;
        this.abort(reason ?? Error('Inference stream cancelled'));
    }

    public get cancelled(): boolean {
        return this.consumerCancelled;
    }

    private timer(timeoutMs: number, message: string): ReturnType<typeof setTimeout> | undefined {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || this.signal.aborted) return undefined;
        return setTimeout(() => this.abort(Error(message)), timeoutMs);
    }

    private abort(reason: unknown): void {
        if (this.signal.aborted) return;
        this.controller.abort(reason);
        if (this.reader) void this.reader.cancel(reason).catch(() => undefined);
    }
}

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
 * The two maps route interleaved provider wire tool-call deltas to the right internal action request.
 */
export const createProtocolStreamState = (): ProtocolStreamState => ({
    buffer: '',
    finished: false,
    actionRequestsByIndex: new Map(),
    actionRequestsById: new Map(),
    nextActionIndex: 0,
});

/**
 * Creates a cancellable structured event stream for one provider-facing LLM request.
 * Provider wire tool calls are normalized into action events before callers see the stream.
 */
export const createInferenceRequestStream = (
    config: FModelConfiguration,
    messages: ProviderMessage[],
    signal: AbortSignal,
    tools?: InferenceToolDefinition[],
    limits: InferenceRequestLimits = { requestTimeoutMs: 60000, staleTimeoutMs: 30000 },
): ReadableStream<InferenceEvent> => {
    if (messages.length === 0) {
        throw Error('LLM provider request messages are missing');
    }
    let control: InferenceRequestControl | undefined;
    return new ReadableStream<InferenceEvent>({
        start: (controller) => {
            control = new InferenceRequestControl(signal, limits);
            return start(controller, config, messages, control, tools);
        },
        cancel: (reason) => control?.cancel(reason),
    });
};

/**
 * EN: start function declaration.
 * ZH: start function 声明。
 */
async function start(controller: ReadableStreamDefaultController<InferenceEvent>, config: FModelConfiguration, messages: ProviderMessage[], control: InferenceRequestControl, tools: InferenceToolDefinition[] | undefined): Promise<void> {
    try {
        await requestLlm(controller, config, messages, control, tools);
    } catch (error) {
        if (!control.cancelled) controller.error(error);
    } finally {
        control.close();
    }
}

/**
 * EN: requestLlm function declaration.
 * ZH: requestLlm function 声明。
 */
async function requestLlm(controller: ReadableStreamDefaultController<InferenceEvent>, config: FModelConfiguration, messages: ProviderMessage[], control: InferenceRequestControl, tools?: InferenceToolDefinition[]): Promise<void> {
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
                signal: control.signal,
                body: JSON.stringify(body),
            });
            control.activity();
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
            control.bind(reader);
            await readStreamingContent(controller, reader, context, control);
            return;
        }
    }
    throw Object.assign(Error(protocolMatchFailureMessage(config.provider, errors)), {
        detail: { provider: config.provider, errors },
    });
}

/**
 * EN: protocolMatchFailureMessage function declaration.
 * ZH: protocolMatchFailureMessage function 声明。
 */
function protocolMatchFailureMessage(provider: string, errors: Array<Record<string, unknown>>): string {
    if (errors.length === 0) return 'LLM provider protocol matching failed';
    const attempts = errors.map((error) => JSON.stringify(error)).join(' | ');
    return `LLM provider protocol matching failed (${provider}): ${attempts}`;
}

/**
 * EN: protocols function declaration.
 * ZH: protocols function 声明。
 */
function protocols(config: FModelConfiguration) {
    if (config.protocols.length === 0) throw Error('LLM provider protocols are missing');
    return config.protocols;
}

/**
 * EN: headers function declaration.
 * ZH: headers function 声明。
 */
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

/**
 * EN: urls function declaration.
 * ZH: urls function 声明。
 */
function urls(context: ProtocolBuildContext): string[] {
    const baseUrl = (context.protocol.baseUrl ?? context.config.baseUrl).replace(/\/+$/, '');
    const path = replaceModel(context.protocol.path, context.model);
    const urls = [joinEndpoint(baseUrl, path)];
    if (context.protocol.usesV1Fallback === true && !baseUrl.endsWith('/v1')) {
        urls.push(joinEndpoint(baseUrl + '/v1', path));
    }
    return [...new Set(urls)];
}

/**
 * EN: joinEndpoint function declaration.
 * ZH: joinEndpoint function 声明。
 */
function joinEndpoint(baseUrl: string, path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return baseUrl + (path.startsWith('/') ? '' : '/') + path;
}

/**
 * EN: replaceModel function declaration.
 * ZH: replaceModel function 声明。
 */
function replaceModel(path: string, model: string): string {
    return path.replaceAll('{model}', encodeURIComponent(model));
}

/**
 * EN: canTryNextProtocol function declaration.
 * ZH: canTryNextProtocol function 声明。
 */
function canTryNextProtocol(status: number): boolean {
    return [400, 404, 405, 415, 422, 501].includes(status);
}

/**
 * EN: isJsonResponse function declaration.
 * ZH: isJsonResponse function 声明。
 */
function isJsonResponse(context: ProtocolBuildContext, contentType: string): boolean {
    if (context.protocol.acceptsJsonStream === true) return false;
    return contentType.toLowerCase().includes('application/json');
}

/**
 * EN: responsesText function declaration.
 * ZH: responsesText function 声明。
 */
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

/**
 * EN: readStreamingContent function declaration.
 * ZH: readStreamingContent function 声明。
 */
async function readStreamingContent(controller: ReadableStreamDefaultController<InferenceEvent>, reader: LlmByteStreamReader, context: ProtocolBuildContext, control: InferenceRequestControl): Promise<void> {
    // Providers may split UTF-8 bytes and SSE/JSON lines across chunks, so decoding is buffered.
    const decoder = new TextDecoder();
    const state = createProtocolStreamState();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            control.activity();
            state.buffer += decoder.decode(value, { stream: true });
            await drainStreamingLines(controller, reader, state, context.adapter);
            if (state.finished) return;
        }
        if (control.signal.aborted) throw control.signal.reason ?? Error('Inference request aborted');
        state.buffer += decoder.decode();
        if (state.buffer.trim().length > 0) {
            await drainStreamingLines(controller, reader, state, context.adapter, true);
            if (state.finished) return;
        }
        throw Error(context.protocol.missingTerminalMessage ?? 'LLM provider stream ended without a terminal event');
    } catch (error) {
        if (control.signal.aborted) throw control.signal.reason ?? error;
        throw error;
    } finally {
        if (!state.finished) await reader.cancel(control.signal.reason).catch(() => undefined);
    }
}

/**
 * EN: drainStreamingLines function declaration.
 * ZH: drainStreamingLines function 声明。
 */
async function drainStreamingLines(controller: ReadableStreamDefaultController<InferenceEvent>, reader: LlmByteStreamReader, state: ProtocolStreamState, adapter: ProtocolAdapter, flush = false): Promise<void> {
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
