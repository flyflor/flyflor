import type { FModelConfiguration } from '@/config';
import { Config, FService, Service } from '@/core';
import { createIntelligenceTurnStream } from './factory';
import type { AgentMemory } from './types';

interface IntelligenceReader {
    read(): Promise<{ done: boolean; value?: string }>;
    releaseLock(): void;
    cancel(reason?: unknown): Promise<void>;
}

@Service()
export class Intelligence extends FService {
    @Config('model')
    public config!: FModelConfiguration;

    public reader(messages: AgentMemory[]) {
        return createIntelligenceTurnStream({
            llm: this.config.model,
            messages,
            modelOverride: this.modelOverride,
            maxTokens: this.maxTokens,
        }).getReader();
    }
}
