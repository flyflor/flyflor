import type { ConfigService, FAgentProfileConfiguration, FModelConfiguration } from '@/configuration';
import { Config, FService, Init, Provide } from '@/core';
import { createInferenceRequestStream } from './factory';
import type { ActionRequest } from '@/plugins';
import type { InferenceEvent, InferenceStopReason, InferenceToolDefinition, ProviderMessage } from './types';

const MAX_ACTION_REQUEST_ID_CHARS = 256;

/**
 * One finished provider result assembled from the event stream.
 * `text` is the visible answer; `actionRequests` carries model-requested actions; `reasoning` is
 * provider thinking text that must be replayed with action requests on the next local provider call
 * so compatible providers can continue the same response cycle.
 */
export interface InferenceResult {
    text: string;
    reasoning: string;
    actionRequests: ActionRequest[];
    stopReason: InferenceStopReason;
}

@Provide()
/**
 * EN: Inference class declaration.
 * ZH: Inference class 声明。
 */
export class Inference extends FService {
    @Config()
    public root!: ConfigService;

    public config: FModelConfiguration;
    private requestTimeoutMs = 60000;
    private staleTimeoutMs = 30000;

    constructor(private readonly profile?: FAgentProfileConfiguration) {
        super();
        this.config = {} as FModelConfiguration;
    }

    @Init()
    public initProfile(): void {
        const profile = this.profile ?? {
            name: 'collective',
            role: 'leader' as const,
            description: 'Collective infrastructure inference',
            capabilities: [],
            actionScope: 'full' as const,
            model: '',
            provider: '',
            contextLength: 0,
            maxTokens: 0,
        };
        const config = this.root.model;
        const provider = profile.provider || config.provider;
        const model = profile.model || config.model || config.default;
        const providerConfig = this.root.providers[provider];
        const modelConfig = providerConfig?.models?.[model];
        this.config = {
            ...config,
            model,
            provider,
            contextLength: profile.contextLength || config.contextLength,
            maxTokens: profile.maxTokens || config.maxTokens,
            protocols: this.root.providers[provider]?.protocols ?? config.protocols,
        };
        this.requestTimeoutMs = this.milliseconds(modelConfig?.timeoutSeconds ?? providerConfig?.requestTimeoutSeconds, 60);
        this.staleTimeoutMs = this.milliseconds(modelConfig?.staleTimeoutSeconds ?? providerConfig?.staleTimeoutSeconds, 30);
    }

    /**
     * Opens one streaming provider request.
     * Callers receive structured provider events and do not need to know protocol details.
     */
    public reader(messages: ProviderMessage[], tools?: InferenceToolDefinition[], signal?: AbortSignal) {
        return createInferenceRequestStream(
            this.config,
            messages,
            signal ?? new AbortController().signal,
            tools,
            { requestTimeoutMs: this.requestTimeoutMs, staleTimeoutMs: this.staleTimeoutMs },
        ).getReader();
    }

    /**
     * Streams one text provider request, forwarding only visible text deltas.
     * 中文：业务对象只关心 chunk；reader 生命周期留在 Inference 内部统一处理。
     */
    public async stream(messages: ProviderMessage[], next: (chunk: string) => void, signal?: AbortSignal): Promise<void> {
        await this.consume(this.reader(messages, undefined, signal), next);
    }

    /**
     * Runs one full text provider request, concatenating visible text deltas.
     * Used by attention and context classification, which expect a plain string answer.
     */
    public async completeText(messages: ProviderMessage[], signal?: AbortSignal): Promise<string> {
        const result = await this.runRequest(messages, undefined, signal);
        return result.text;
    }

    /**
     * Runs one full provider request, optionally advertising tools, and assembles the structured result.
     * The research loop uses action requests to drive tool execution before continuing.
     */
    public async runRequest(messages: ProviderMessage[], tools?: InferenceToolDefinition[], signal?: AbortSignal): Promise<InferenceResult> {
        return this.consume(this.reader(messages, tools, signal));
    }

    /**
     * Streams one research request, forwarding text deltas live while collecting action requests.
     * Lets the loop surface a streamed answer and act on tool requests from the same response cycle.
     */
    public async streamRequest(messages: ProviderMessage[], tools: InferenceToolDefinition[] | undefined, onText: (chunk: string) => void, signal?: AbortSignal): Promise<InferenceResult> {
        return this.consume(this.reader(messages, tools, signal), onText);
    }

    /**
     * Drains one structured provider stream into a finished `InferenceResult`.
     * `onText` (when given) forwards visible text deltas live so the loop can stream a partial answer.
     */
    private async consume(reader: ReturnType<Inference['reader']>, onText?: (chunk: string) => void): Promise<InferenceResult> {
        const result: InferenceResult = { text: '', reasoning: '', actionRequests: [], stopReason: 'stop' };
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                this.reduce(value, result, onText);
            }
            return result;
        } catch (error) {
            await reader.cancel(error).catch(() => undefined);
            throw error;
        } finally {
            reader.releaseLock();
        }
    }

    private reduce(event: InferenceEvent | undefined, result: InferenceResult, onText?: (chunk: string) => void): void {
        if (event === undefined) return;
        if (event.type === 'text_delta') {
            result.text += event.text;
            onText?.(event.text);
        } else if (event.type === 'reasoning_delta') {
            result.reasoning += event.text;
        } else if (event.type === 'action_end') {
            result.actionRequests.push(this.actionRequest(event.request, result.actionRequests));
        } else if (event.type === 'done') {
            result.stopReason = event.stopReason;
        }
    }

    private actionRequest(request: ActionRequest, existing: ActionRequest[]): ActionRequest {
        const source = typeof request.id === 'string' ? request.id.trim() : '';
        const base = (source || `action_${existing.length + 1}`).slice(0, MAX_ACTION_REQUEST_ID_CHARS);
        const ids = new Set(existing.map((item) => item.id));
        let id = base;
        let suffix = 2;
        while (ids.has(id)) {
            const ending = `_${suffix}`;
            id = `${base.slice(0, MAX_ACTION_REQUEST_ID_CHARS - ending.length)}${ending}`;
            suffix += 1;
        }
        return { ...request, id };
    }

    private milliseconds(value: number | undefined, fallbackSeconds: number): number {
        const seconds = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallbackSeconds;
        return Math.max(1, Math.floor(seconds * 1000));
    }
}
