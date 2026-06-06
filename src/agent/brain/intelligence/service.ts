import type { FModelConfiguration } from '@/config';
import { FService, Service } from '@/core';
import { createIntelligenceTurnStream } from './factory';
import type { AgentChatMessage, IntelligenceRequest, IntelligenceTurn } from './types';

interface IntelligenceReader {
    read(): Promise<{ done: boolean; value?: string }>;
    releaseLock(): void;
    cancel(reason?: unknown): Promise<void>;
}

@Service()
export class Intelligence extends FService {
    private readonly llm: FModelConfiguration;
    private readonly modelOverride?: string;
    private readonly maxTokens?: number;

    public constructor(request: IntelligenceRequest) {
        super();
        this.llm = request.llm;
        this.modelOverride = request.modelOverride;
        this.maxTokens = request.maxTokens;
    }

    public turn(messages: AgentChatMessage[]): IntelligenceTurn {
        const reader = this.reader(messages);
        return {
            read: () => reader.read(),
            cancel: (reason?: unknown) => reader.cancel(reason),
            release: () => reader.releaseLock(),
        };
    }

    public async complete(messages: AgentChatMessage[]): Promise<string> {
        const turn = this.turn(messages);
        let content = '';
        try {
            while (true) {
                const { done, value } = await turn.read();
                if (done) break;
                content += value;
            }
        } finally {
            turn.release();
        }
        if (content.length === 0) {
            throw Error('LLM provider returned an empty response');
        }
        return content;
    }

    private reader(messages: AgentChatMessage[]): IntelligenceReader {
        return createIntelligenceTurnStream({
            llm: this.llm,
            messages,
            modelOverride: this.modelOverride,
            maxTokens: this.maxTokens,
        }).getReader();
    }
}
