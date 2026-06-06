import { type FModelProtocolConfiguration, FModelProtocolName } from '@/config';
import { anthropicMessagesAdapter, awsBedrockConverseAdapter, cohereChatAdapter, googleGeminiGenerateContentAdapter, huggingFaceAdapter, lmStudioAdapter, ollamaAdapter, openAIChatCompletionsAdapter, openAIResponsesAdapter, vllmAdapter } from './protocols';
import type { IntelligenceTurnRequest, LlmByteStreamReader, ProtocolAdapter, ProtocolBuildContext, ProviderAttemptFailure, ProviderConnection, ProviderRequestCandidate, StreamingState } from './types';

const DEFAULT_PROTOCOLS: FModelProtocolConfiguration[] = [{ name: FModelProtocolName.OpenAIChatCompletions }, { name: FModelProtocolName.OpenAIResponses }];

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

export const createIntelligenceTurnStream = (request: IntelligenceTurnRequest): ReadableStream<string> => {
    if (request.messages.length === 0) {
        throw Error('LLM provider request messages are missing');
    }
    const abortController = new AbortController();
    return new ReadableStream<string>({
        start: (controller) => start(controller, request, abortController),
        cancel: (reason) => abortController.abort(reason),
    });
};

async function start(controller: ReadableStreamDefaultController<string>, request: IntelligenceTurnRequest, abortController: AbortController): Promise<void> {
    try {
        await runRequest(controller, request, abortController);
    } catch (error) {
        abortController.abort(error);
        controller.error(error);
    }
}

async function runRequest(controller: ReadableStreamDefaultController<string>, request: IntelligenceTurnRequest, abortController: AbortController): Promise<void> {
    const resolvedModel = request.modelOverride ?? request.llm.model ?? request.llm.default;
    const connection = await openProviderConnection(request, resolvedModel, abortController);
    const reader = connection.response.body?.getReader();
    if (reader === undefined) {
        throw Object.assign(Error('LLM provider returned no response body'), {
            detail: { provider: request.llm.provider, protocol: connection.candidate.protocol },
        });
    }
    await readStreamingContent(controller, reader, connection.candidate.adapter);
}

async function openProviderConnection(request: IntelligenceTurnRequest, resolvedModel: string, abortController: AbortController): Promise<ProviderConnection> {
    const attempts: ProviderAttemptFailure[] = [];
    for (const candidate of requestCandidates(request, resolvedModel)) {
        const response = await fetch(candidate.url, {
            method: 'POST',
            headers: candidate.headers,
            signal: abortController.signal,
            body: JSON.stringify(candidate.body),
        });
        if (response.ok) {
            const contentType = response.headers.get('content-type') ?? undefined;
            if (isNonStreamingResponse(candidate.adapter, contentType)) {
                attempts.push({
                    protocol: candidate.protocol,
                    url: candidate.url,
                    status: response.status,
                    body: await response.text(),
                    contentType,
                });
                continue;
            }
            return { candidate, response };
        }
        const body = await response.text();
        if (!canTryNextProtocol(response.status)) {
            throw Object.assign(Error('LLM provider request failed'), {
                detail: { provider: request.llm.provider, protocol: candidate.protocol, status: response.status, body },
            });
        }
        attempts.push({ protocol: candidate.protocol, url: candidate.url, status: response.status, body });
    }
    throw Object.assign(Error('LLM provider protocol matching failed'), {
        detail: { provider: request.llm.provider, attempts },
    });
}

function requestCandidates(request: IntelligenceTurnRequest, resolvedModel: string): ProviderRequestCandidate[] {
    const maxTokens = request.maxTokens ?? request.llm.maxTokens;
    const candidates: ProviderRequestCandidate[] = [];
    for (const protocol of resolvedProtocols(request)) {
        if (protocol.enabled === false) continue;
        const adapter = PROTOCOLS.get(protocol.name);
        if (adapter === undefined) {
            throw Object.assign(Error('Unsupported LLM protocol'), { detail: { protocol: protocol.name } });
        }
        const context: ProtocolBuildContext = { request, protocol, adapter, resolvedModel, maxTokens };
        const body = adapter.body(context);
        for (const url of endpointUrls(context)) {
            candidates.push(baseCandidate(context, url, body));
        }
    }
    return candidates;
}

function resolvedProtocols(request: IntelligenceTurnRequest) {
    return request.llm.protocols && request.llm.protocols.length > 0 ? request.llm.protocols : DEFAULT_PROTOCOLS;
}

function baseCandidate(context: ProtocolBuildContext, url: string, body: Record<string, unknown>): ProviderRequestCandidate {
    return {
        protocol: context.protocol.name,
        adapter: context.adapter,
        url,
        headers: headers(context),
        body,
    };
}

function headers(context: ProtocolBuildContext): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKeyEnv = context.protocol.apiKeyEnv ?? context.request.llm.apiKeyEnv;
    if (context.adapter.auth === 'none') {
        return headers;
    }
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
    if ((apiKey === undefined || apiKey.length === 0) && context.adapter.auth === 'optionalBearer') {
        return headers;
    }
    if (apiKey === undefined || apiKey.length === 0) {
        throw Object.assign(Error('LLM provider API key is missing'), {
            detail: { provider: context.request.llm.provider, protocol: context.protocol.name, apiKeyEnv },
        });
    }
    if (context.adapter.auth === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = context.protocol.version ?? context.adapter.defaultVersion ?? '2023-06-01';
        return headers;
    }
    if (context.adapter.auth === 'google') {
        headers['x-goog-api-key'] = apiKey;
        return headers;
    }
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
}

function endpointUrls(context: ProtocolBuildContext): string[] {
    const baseUrl = (context.protocol.baseUrl ?? context.request.llm.baseUrl).replace(/\/+$/, '');
    const path = replaceModel(context.protocol.path ?? context.adapter.defaultPath, context.resolvedModel);
    const urls = [joinEndpoint(baseUrl, path)];
    if (context.adapter.usesV1Fallback && !baseUrl.endsWith('/v1')) {
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

function isNonStreamingResponse(adapter: ProtocolAdapter, contentType?: string): boolean {
    if (adapter.acceptsJsonStream) return false;
    return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}

async function readStreamingContent(controller: ReadableStreamDefaultController<string>, reader: LlmByteStreamReader, adapter: ProtocolAdapter): Promise<void> {
    const decoder = new TextDecoder();
    const state: StreamingState = { buffer: '', finished: false };
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        state.buffer += decoder.decode(value, { stream: true });
        await drainStreamingLines(controller, reader, state, adapter);
        if (state.finished) return;
    }
    state.buffer += decoder.decode();
    if (state.buffer.trim().length > 0) {
        await drainStreamingLines(controller, reader, state, adapter, true);
        if (state.finished) return;
    }
    throw Error(adapter.missingTerminalMessage());
}

async function drainStreamingLines(controller: ReadableStreamDefaultController<string>, reader: LlmByteStreamReader, state: StreamingState, adapter: ProtocolAdapter, flush = false): Promise<void> {
    const lines = state.buffer.split('\n');
    state.buffer = flush ? '' : (lines.pop() ?? '');
    for (const line of lines) {
        if (adapter.parseLine(controller, line)) {
            state.finished = true;
            controller.close();
            await reader.cancel();
            return;
        }
    }
}
