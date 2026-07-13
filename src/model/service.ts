import type { ConfigService, FAgentProfileConfiguration } from '@/config';
import { Config, FAgent, FService, Init, Inject, Provide } from '@/core';
import { ProtocolClient } from './protocol/client';
import type { ModelOptions } from './protocol/types';
import type { Message, ModelResult, StopReason, StreamEvent, ToolDefinition } from './types';

/**
 * EN: Agent-scoped language-model boundary with fully awaited streaming callbacks.
 * ZH: Agent scoped 语言模型边界，完整等待所有流式回调。
 */
@Provide()
export class Model extends FService {
    @Config()
    public root!: ConfigService;

    @Inject()
    public client!: ProtocolClient;

    /**
     * EN: Binds one model instance to exactly one complete Agent profile.
     * ZH: 将一个模型实例绑定到唯一、完整的 Agent profile。
     */
    public constructor(agent: FAgent<unknown, unknown, FAgentProfileConfiguration, unknown>) {
        super();
        this.profile = agent.agentConfig;
        this.options = undefined;
    }

    private readonly profile: FAgentProfileConfiguration;
    private options: ModelOptions | undefined;

    /** EN: Returns the initialized provider options owned by this Agent scope. ZH: 返回由当前 Agent scope 持有的已初始化 provider 选项。 */
    public get config(): ModelOptions {
        if (this.options === undefined) throw Error(`Agent model is not initialized: ${this.profile.name}`);
        return this.options;
    }

    /**
     * EN: Builds the exact provider request configuration after IOC injection.
     * ZH: 在 IOC 注入后构造精确的 provider 请求配置。
     */
    @Init()
    public initProfile(): void {
        const profile = this.profile;
        if (!profile.model || !profile.provider
            || !Number.isFinite(profile.contextLength) || profile.contextLength <= 0
            || !Number.isFinite(profile.maxTokens) || profile.maxTokens <= 0
            || profile.maxTokens >= profile.contextLength) {
            throw Error(`Agent model profile is incomplete: ${profile.name}`);
        }
        const base = this.root.model;
        this.options = {
            ...base,
            model: profile.model,
            provider: profile.provider,
            contextLength: profile.contextLength,
            maxTokens: profile.maxTokens,
        };
    }

    /** EN: Reports when one investigation history should be summarized before another request. ZH: 报告调查历史是否应在下一次请求前完成摘要。 */
    public needsSummary(messages: Message[], tools?: ToolDefinition[]): boolean {
        const available = this.config.contextLength - this.config.maxTokens;
        const bytes = Buffer.byteLength(JSON.stringify({ messages, tools: tools ?? [] }));
        const estimatedTokens = Math.ceil(bytes / 4);
        return estimatedTokens >= Math.floor(available * 0.8);
    }

    /** EN: Opens one provider stream reader. ZH: 打开一个 provider stream reader。 */
    public reader(messages: Message[], tools?: ToolDefinition[]) {
        const timeout = Math.max(1, this.config.timeoutSeconds) * 1000;
        return this.client.stream(this.config, messages, AbortSignal.timeout(timeout), tools).getReader();
    }

    /** EN: Streams text and awaits every consumer callback. ZH: 流式输出文本并等待每个消费回调。 */
    public async stream(messages: Message[], next: (chunk: string) => void | Promise<void>): Promise<void> {
        await this.consume(this.reader(messages), false, next);
    }

    /** EN: Completes one text-only model request. ZH: 完成一次纯文本模型请求。 */
    public async completeText(messages: Message[]): Promise<string> {
        return (await this.run(messages)).text;
    }

    /** EN: Consumes one complete model request with optional tools. ZH: 消费一次可带工具的完整模型请求。 */
    public async run(messages: Message[], tools?: ToolDefinition[]): Promise<ModelResult> {
        return await this.consume(this.reader(messages, tools), (tools?.length ?? 0) > 0);
    }

    /** EN: Consumes one tool-capable request while awaiting text output. ZH: 消费一次可调用工具的请求，并等待文本输出。 */
    public async streamRun(messages: Message[], tools: ToolDefinition[] | undefined, onText: (chunk: string) => void | Promise<void>): Promise<ModelResult> {
        return await this.consume(this.reader(messages, tools), (tools?.length ?? 0) > 0, onText);
    }

    /** EN: Reduces a provider stream into one strict result. ZH: 将 provider stream 归并为一个严格结果。 */
    private async consume(reader: ReturnType<Model['reader']>, allowTools: boolean, onText?: (chunk: string) => void | Promise<void>): Promise<ModelResult> {
        const result: ModelResult = { text: '', reasoning: '', toolCalls: [] };
        let terminal: StopReason | undefined;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (terminal) throw Error('Model stream emitted data after its terminal event');
                if (value?.type === 'done') {
                    terminal = value.stopReason;
                    continue;
                }
                await this.reduce(value, result, onText);
            }
            if (!terminal) throw Error('Model stream ended without a terminal event');
            if (terminal === 'length') throw Error('Model response reached the token limit');
            const usedTools = result.toolCalls.length > 0;
            if ((terminal === 'toolUse') !== usedTools) throw Error('Model tool-use terminal does not match tool calls');
            if (usedTools && !allowTools) throw Error('Text-only model response used tools');
            return result;
        } finally {
            reader.releaseLock();
        }
    }

    /** EN: Applies one stream event and awaits observable text effects. ZH: 应用一个流事件并等待可观察文本效果。 */
    private async reduce(event: StreamEvent | undefined, result: ModelResult, onText?: (chunk: string) => void | Promise<void>): Promise<void> {
        if (event === undefined) throw Error('Model stream emitted an empty event');
        if (event.type === 'text_delta') {
            result.text += event.text;
            if (onText) await onText(event.text);
        } else if (event.type === 'reasoning_delta') {
            result.reasoning += event.text;
        } else if (event.type === 'tool_end') {
            result.toolCalls.push(event.call);
        }
    }
}
