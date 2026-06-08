import { FService, Inject, Logger, Service, type FLogger } from '@/core';
import { type FAgentProfileConfiguration } from '@/config';
import { AgentChatRole } from './intelligence';
import { Memory } from '../memory';
import { Intelligence } from './intelligence';

@Service()
export class Brain extends FService {
    @Inject()
    public intelligence!: Intelligence;

    @Inject(function (this: Brain) {
        return this.config;
    })
    public memory!: Memory;

    @Logger(Brain.name)
    public readonly log!: FLogger;

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    public async *transformer(content: string): AsyncGenerator<string> {
        const result = await this.memory.messages(content);
        if (typeof result === 'string') {
            this.memory.context.push({ role: AgentChatRole.User, content });
            this.memory.context.push({ role: AgentChatRole.Assistant, content: result });
            yield result;
            return;
        }

        this.log.debug('transformer', content, result);
        const reader = this.intelligence.reader(result);
        let assistant = '';
        let completed = false;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    completed = true;
                    break;
                }
                assistant += value ?? '';
                yield value ?? '';
            }
        } finally {
            if (!completed) await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }

        if (!completed) return;
        this.memory.context.push({ role: AgentChatRole.User, content });
        this.memory.context.push({ role: AgentChatRole.Assistant, content: assistant });
    }
}
