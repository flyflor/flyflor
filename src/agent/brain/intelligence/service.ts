import type { ConfigService, FAgentProfileConfiguration, FModelConfiguration } from '@/configuration';
import { Config, FService, Init, Provide } from '@/core';
import { createIntelligenceRequestStream } from './factory';
import type { ActionRequest } from '@/plugins';
import type { IntelligenceEvent, IntelligenceStopReason, IntelligenceToolDefinition, ProviderMessage } from './types';

/**
 * EN: One finished provider result assembled from the event stream.
 * `text` is the visible answer; `actionRequests` carries model-requested actions; `reasoning` is
 * provider thinking text that must be replayed with action requests on the next local provider call
 * so compatible providers can continue the same response cycle.
 * ZH: 从事件流组装出的一次完整 provider 结果。`text` 是可见答案；`actionRequests` 承载模型
 * 请求的 action；`reasoning` 是 provider 的思考文本，在下一次本地 provider 调用时必须随
 * action request 一起回放，以便兼容的 provider 延续同一响应周期。
 */
export interface IntelligenceResult {
    /** EN: Visible answer text. ZH: 可见答案文本。 */
    text: string;
    /** EN: Provider thinking text kept for replay. ZH: 保留用于回放的 provider 思考文本。 */
    reasoning: string;
    /** EN: Actions the model asked the runtime to execute. ZH: 模型请求运行时执行的 action 列表。 */
    actionRequests: ActionRequest[];
    /** EN: Reason the provider request ended. ZH: provider 请求结束的原因。 */
    stopReason: IntelligenceStopReason;
}

/**
 * EN: Intelligence is the provider-facing service of one agent profile. It owns
 * model configuration resolution and turns provider event streams into the
 * structured results the brain consumes.
 * ZH: Intelligence 是单个 agent profile 面向 provider 的服务。它负责解析模型
 * 配置，并把 provider 事件流转换成 brain 消费的结构化结果。
 */
@Provide()
export class Intelligence extends FService {
    @Config()
    /** EN: Root configuration service. ZH: 根配置服务。 */
    public root!: ConfigService;

    /** EN: Resolved model configuration for the active profile. ZH: 当前 profile 解析后的模型配置。 */
    public config: FModelConfiguration;

    constructor(private readonly profile: FAgentProfileConfiguration | undefined = undefined) {
        super();
        this.config = {} as FModelConfiguration;
    }

    /**
     * EN: Resolves the effective model configuration by overlaying the profile onto the root model config.
     * ZH: 通过把 profile 叠加到根模型配置之上，解析出实际生效的模型配置。
     */
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
     * EN: Opens one streaming provider request.
     * Callers receive structured provider events and do not need to know protocol details.
     * ZH: 打开一次流式 provider 请求。调用方收到结构化 provider 事件，无需了解协议细节。
     */
    public reader(messages: ProviderMessage[], tools?: IntelligenceToolDefinition[], signal?: AbortSignal) {
        const requestSignal = signal ?? new AbortController().signal;
        return createIntelligenceRequestStream(this.config, messages, requestSignal, tools).getReader();
    }

    /**
     * EN: Streams one text provider request, forwarding only visible text deltas.
     * ZH: 流式运行一次文本 provider 请求，只转发可见文本增量。业务对象只关心 chunk；reader 生命周期留在 Intelligence 内部统一处理。
     */
    public async stream(messages: ProviderMessage[], next: (chunk: string) => void, signal?: AbortSignal): Promise<void> {
        const reader = this.reader(messages, undefined, signal);
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value?.type === 'text_delta' && value.text.length > 0) next(value.text);
            }
        } catch (error) {
            try {
                await reader.cancel(error);
            } catch {
                // Preserve the provider/caller error when a closed reader rejects cancellation.
            }
            throw error;
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Runs one full text provider request, concatenating visible text deltas.
     * Used by compact semantic classification and planning calls, which expect a plain string answer.
     * ZH: 运行一次完整的文本 provider 请求，拼接可见文本增量。用于紧凑的语义分类与规划调用，它们只需要纯字符串答案。
     */
    public async completeText(messages: ProviderMessage[], signal?: AbortSignal): Promise<string> {
        const result = await this.runRequest(messages, undefined, signal);
        return result.text;
    }

    /**
     * Runs one full provider request, optionally advertising tools, and assembles the structured result.
     * The research loop uses action requests to drive tool execution before continuing.
     * ZH: 运行一次完整的 provider 请求（可选地声明工具），并组装结构化结果。研究循环用 action request 驱动工具执行后再继续。
     */
    public async runRequest(messages: ProviderMessage[], tools?: IntelligenceToolDefinition[], signal?: AbortSignal): Promise<IntelligenceResult> {
        return this.consume(this.reader(messages, tools, signal));
    }

    /**
     * Streams one research request, forwarding text deltas live while collecting action requests.
     * Lets the loop surface a streamed answer and act on tool requests from the same response cycle.
     * ZH: 流式运行一次研究请求，实时转发文本增量并同时收集 action request。让循环既能展示流式答案，又能在同一响应周期内响应工具请求。
     */
    public async streamRequest(messages: ProviderMessage[], tools: IntelligenceToolDefinition[] | undefined, onText: (chunk: string) => void, signal?: AbortSignal): Promise<IntelligenceResult> {
        return this.consume(this.reader(messages, tools, signal), onText);
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
        } catch (error) {
            try {
                await reader.cancel(error);
            } catch {
                // Preserve the provider/caller error when a closed reader rejects cancellation.
            }
            throw error;
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
