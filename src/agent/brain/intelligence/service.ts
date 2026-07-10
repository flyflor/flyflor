import type { ConfigService, FAgentProfileConfiguration, FModelConfiguration } from '@/configuration';
import { Config, FService, Init, Provide } from '@/core';
import { createIntelligenceRequestStream } from './factory';
import type { ActionRequest } from '@/plugins';
import type { IntelligenceEvent, IntelligenceStopReason, IntelligenceToolDefinition, ProviderMessage } from './types';

/**
 * One finished provider result assembled from the event stream.
 * `text` is the visible answer; `actionRequests` carries model-requested actions; `reasoning` is
 * provider thinking text that must be replayed with action requests on the next local provider call
 * so compatible providers can continue the same response cycle.
 */
export interface IntelligenceResult {
    text: string;
    reasoning: string;
    actionRequests: ActionRequest[];
    stopReason: IntelligenceStopReason;
}

@Provide()
/**
 * EN: Intelligence class declaration.
 * ZH: Intelligence class 声明。
 */
export class Intelligence extends FService {
    @Config()
    public root!: ConfigService;

    public config: FModelConfiguration;

    constructor(private readonly profile?: FAgentProfileConfiguration) {
        super();
        this.config = {} as FModelConfiguration;
    }

    @Init()
    public initProfile(): void {
        const profile = this.profile ?? { name: 'cortex', model: '', provider: '', contextLength: 0, maxTokens: 0 };
        const config = this.root.model;
        const provider = profile.provider || config.provider;
        this.config = {
            ...config,
            model: profile.model || config.model || config.default,
            provider,
            contextLength: profile.contextLength || config.contextLength,
            maxTokens: profile.maxTokens || config.maxTokens,
            protocols: this.root.providers[provider]?.protocols ?? config.protocols,
        };
    }

    /**
     * Opens one streaming provider request.
     * Callers receive structured provider events and do not need to know protocol details.
     */
    public reader(messages: ProviderMessage[], tools?: IntelligenceToolDefinition[]) {
        const abortController = new AbortController();
        return createIntelligenceRequestStream(this.config, messages, abortController.signal, tools).getReader();
    }

    /**
     * Streams one text provider request, forwarding only visible text deltas.
     * 中文：业务对象只关心 chunk；reader 生命周期留在 Intelligence 内部统一处理。
     */
    public async stream(messages: ProviderMessage[], next: (chunk: string) => void): Promise<void> {
        const reader = this.reader(messages);
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value?.type === 'text_delta' && value.text.length > 0) next(value.text);
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Runs one full text provider request, concatenating visible text deltas.
     * Used by route classification and soul write planning, which expect a plain string answer.
     */
    public async completeText(messages: ProviderMessage[]): Promise<string> {
        const result = await this.runRequest(messages);
        return result.text;
    }

    /**
     * Runs one full provider request, optionally advertising tools, and assembles the structured result.
     * The research loop uses action requests to drive tool execution before continuing.
     */
    public async runRequest(messages: ProviderMessage[], tools?: IntelligenceToolDefinition[]): Promise<IntelligenceResult> {
        return this.consume(this.reader(messages, tools));
    }

    /**
     * Streams one research request, forwarding text deltas live while collecting action requests.
     * Lets the loop surface a streamed answer and act on tool requests from the same response cycle.
     */
    public async streamRequest(messages: ProviderMessage[], tools: IntelligenceToolDefinition[] | undefined, onText: (chunk: string) => void): Promise<IntelligenceResult> {
        return this.consume(this.reader(messages, tools), onText);
    }

    /**
     * Drains one structured provider stream into a finished `IntelligenceResult`.
     * `onText` (when given) forwards visible text deltas live so the loop can stream a partial answer.
     */
    private async consume(reader: ReturnType<Intelligence['reader']>, onText?: (chunk: string) => void): Promise<IntelligenceResult> {
        const result: IntelligenceResult = { text: '', reasoning: '', actionRequests: [], stopReason: 'stop' };
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                this.reduce(value, result, onText);
            }
            return result;
        } finally {
            reader.releaseLock();
        }
    }

    private reduce(event: IntelligenceEvent | undefined, result: IntelligenceResult, onText?: (chunk: string) => void): void {
        if (event === undefined) return;
        if (event.type === 'text_delta') {
            result.text += event.text;
            onText?.(event.text);
        } else if (event.type === 'reasoning_delta') {
            result.reasoning += event.text;
        } else if (event.type === 'action_end') {
            result.actionRequests.push(event.request);
        } else if (event.type === 'done') {
            result.stopReason = event.stopReason;
        }
    }
}
