import type { ConfigService, FAgentProfileConfiguration } from '@/config';
import { Config, FService, Init, Inject, Provide } from '@/core';
import { ProtocolClient } from './protocol/client';
import type { ModelOptions } from './protocol/types';
import type { Message, ModelResult, StreamEvent, ToolDefinition } from './types';

@Provide()
export class Model extends FService {
    @Config()
    public root!: ConfigService;

    @Inject()
    public client!: ProtocolClient;

    public config: ModelOptions;

    public constructor(private readonly profile?: FAgentProfileConfiguration) {
        super();
        this.config = {} as ModelOptions;
    }

    @Init()
    public initProfile(): void {
        const profile = this.profile ?? { name: 'cortex', model: '', provider: '', contextLength: 0, maxTokens: 0 };
        const base = this.root.model;
        const provider = profile.provider || base.provider;
        this.config = {
            ...base,
            model: profile.model || base.model,
            provider,
            maxTokens: profile.maxTokens || 8192,
        };
    }

    public reader(messages: Message[], tools?: ToolDefinition[]) {
        const timeout = Math.max(1, this.config.timeoutSeconds) * 1000;
        return this.client.stream(this.config, messages, AbortSignal.timeout(timeout), tools).getReader();
    }

    public async stream(messages: Message[], next: (chunk: string) => void): Promise<void> {
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

    public async completeText(messages: Message[]): Promise<string> {
        return (await this.run(messages)).text;
    }

    public async run(messages: Message[], tools?: ToolDefinition[]): Promise<ModelResult> {
        return this.consume(this.reader(messages, tools));
    }

    public async streamRun(messages: Message[], tools: ToolDefinition[] | undefined, onText: (chunk: string) => void): Promise<ModelResult> {
        return this.consume(this.reader(messages, tools), onText);
    }

    private async consume(reader: ReturnType<Model['reader']>, onText?: (chunk: string) => void): Promise<ModelResult> {
        const result: ModelResult = { text: '', reasoning: '', toolCalls: [], stopReason: 'stop' };
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

    private reduce(event: StreamEvent | undefined, result: ModelResult, onText?: (chunk: string) => void): void {
        if (event === undefined) return;
        if (event.type === 'text_delta') {
            result.text += event.text;
            onText?.(event.text);
        } else if (event.type === 'reasoning_delta') {
            result.reasoning += event.text;
        } else if (event.type === 'tool_end') {
            result.toolCalls.push(event.call);
        } else if (event.type === 'done') {
            result.stopReason = event.stopReason;
        }
    }
}
