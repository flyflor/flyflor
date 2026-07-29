import { type FModelConfiguration, FModelProtocolName } from '@/configuration';
import { anthropicMessagesAdapter, awsBedrockConverseAdapter, cohereChatAdapter, googleGeminiGenerateContentAdapter, huggingFaceAdapter, lmStudioAdapter, ollamaAdapter, openAIChatCompletionsAdapter, openAIResponsesAdapter, vllmAdapter } from './protocols';
import type { IntelligenceEvent, IntelligenceToolDefinition, LlmByteStreamReader, ProtocolAdapter, ProtocolBuildContext, ProtocolStreamState, ProviderMessage } from './types';

/**
 * EN: Protocol adapters are plain composition objects. The factory owns transport, adapters own wire shapes.
 * ZH: protocol adapter 是纯 composition 对象。factory 负责传输，adapter 负责线协议形态。
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
 * EN: Creates a fresh per-request streaming-accumulation state.
 * The two maps route interleaved provider wire tool-call deltas to the right internal action request.
 * ZH: 为单次请求创建新的流式累积状态。两个 map 把交错的 provider 线协议工具调用 delta 路由到正确的内部 action request。
 */
export const createProtocolStreamState = (): ProtocolStreamState => ({
    buffer: '',
    finished: false,
    actionRequestsByIndex: new Map(),
    actionRequestsById: new Map(),
    nextActionIndex: 0,
});

/**
 * EN: Creates a cancellable structured event stream for one provider-facing LLM request.
 * Provider wire tool calls are normalized into action events before callers see the stream.
 * ZH: 为一次面向 provider 的 LLM 请求创建可取消的结构化事件流。provider 线协议工具调用在调用方看到流之前已被规范化为 action 事件。
 */
export const createIntelligenceRequestStream = (
    config: FModelConfiguration,
    messages: ProviderMessage[],
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

/**
 * EN: Stream start callback that funnels provider errors into the stream error channel.
 * ZH: stream 启动回调，把 provider 错误汇入 stream 的错误通道。
 */
async function start(controller: ReadableStreamDefaultController<IntelligenceEvent>, config: FModelConfiguration, messages: ProviderMessage[], signal: AbortSignal, tools?: IntelligenceToolDefinition[]): Promise<void> {
    try {
        await requestLlm(controller, config, messages, signal, tools);
    } catch (error) {
        controller.error(error);
    }
}

/**
 * EN: Attempts each configured protocol endpoint in order until one streams a terminal event.
 * ZH: 按顺序尝试配置的各个 protocol 端点，直到其中一个流出终止事件。
 */
async function requestLlm(controller: ReadableStreamDefaultController<IntelligenceEvent>, config: FModelConfiguration, messages: ProviderMessage[], signal: AbortSignal, tools?: IntelligenceToolDefinition[]): Promise<void> {
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
    throw Object.assign(Error(protocolMatchFailureMessage(config.provider, errors)), {
        detail: { provider: config.provider, errors },
    });
}

/**
 * EN: Builds the failure message listing every attempted protocol endpoint.
 * ZH: 构造列出所有已尝试 protocol 端点的失败消息。
 */
function protocolMatchFailureMessage(provider: string, errors: Array<Record<string, unknown>>): string {
    if (errors.length === 0) return 'LLM provider protocol matching failed';
    const attempts = errors.map((error) => JSON.stringify(error)).join(' | ');
    return `LLM provider protocol matching failed (${provider}): ${attempts}`;
}

/**
 * EN: Returns the configured protocol list, throwing when none is configured.
 * ZH: 返回已配置的 protocol 列表；未配置任何 protocol 时抛错。
 */
function protocols(config: FModelConfiguration) {
    if (config.protocols.length === 0) throw Error('LLM provider protocols are missing');
    return config.protocols;
}

/**
 * EN: Builds protocol-local auth headers from environment-held API keys.
 * ZH: 用环境变量中保存的 API key 构造 protocol 本地的认证头。
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
 * EN: Builds the candidate endpoint URLs, including the optional `/v1` fallback.
 * ZH: 构造候选端点 URL 列表，包含可选的 `/v1` 回退。
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
 * EN: Joins a base URL and a protocol path into one endpoint URL.
 * ZH: 把 base URL 与 protocol 路径拼接成一个端点 URL。
 */
function joinEndpoint(baseUrl: string, path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return baseUrl + (path.startsWith('/') ? '' : '/') + path;
}

/**
 * EN: Substitutes the `{model}` placeholder inside a protocol path.
 * ZH: 替换 protocol 路径中的 `{model}` 占位符。
 */
function replaceModel(path: string, model: string): string {
    return path.replaceAll('{model}', encodeURIComponent(model));
}

/**
 * EN: Whether an HTTP status usually means the endpoint shape is wrong, so the next protocol may be tried.
 * ZH: 判断 HTTP 状态码是否通常意味着端点形态不匹配，从而可以尝试下一个 protocol。
 */
function canTryNextProtocol(status: number): boolean {
    return [400, 404, 405, 415, 422, 501].includes(status);
}

/**
 * EN: Whether the response should be treated as a non-streaming JSON payload.
 * ZH: 判断响应是否应按非流式 JSON 负载处理。
 */
function isJsonResponse(context: ProtocolBuildContext, contentType: string): boolean {
    if (context.protocol.acceptsJsonStream === true) return false;
    return contentType.toLowerCase().includes('application/json');
}

/**
 * EN: Extracts visible text from a non-streaming Responses JSON payload.
 * ZH: 从非流式 Responses JSON 负载中提取可见文本。
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
 * EN: Reads the provider byte stream, buffering split UTF-8 bytes and lines until a terminal event.
 * ZH: 读取 provider 字节流，缓冲被拆分的 UTF-8 字节与行，直到出现终止事件。
 */
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

/**
 * EN: Feeds complete buffered lines to the adapter and closes the stream on a terminal event.
 * ZH: 把缓冲中完整的行交给 adapter 解析，遇到终止事件时关闭 stream。
 */
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
