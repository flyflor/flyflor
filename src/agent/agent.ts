import { Provide, Logger, FAgent, Scope } from '@/core';
import { Brain, CallosumSignalType, type CallosumSignal } from './brain';
import { Memory } from './memory';
import { type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';

/**
 * The agent: a person-like runtime object. It owns an injected brain (cortex) and memory (prefrontal
 * cache), and is itself the `Subject` the neural layer subscribes to for streamed output.
 *
 * `next()` is only the outward reaction: the brain owns routing, memory use, thinking, and commit.
 */
@Provide()
export class Agent extends FAgent<CallosumSignal> {
    @Scope()
    public brain!: Brain;

    @Logger(Agent.name)
    public readonly log!: FLogger;

    constructor(public readonly agentConfig: FAgentProfileConfiguration, public readonly memory: Memory) {
        super();
    }

    public async run(text: string): Promise<void> {
        this.log.debug('turn.start', text);
        await new Promise<void>((resolve, reject) => {
            let assistant = '';
            const subscription = this.brain.subscribe({
                next: (signal) => {
                    if (signal.type === CallosumSignalType.Reply) assistant += signal.chunk;
                    if (signal.type === CallosumSignalType.Done) {
                        // 中文：只在完整 turn 成功结束后提交，避免半截流式回复污染下一轮上下文。
                        if (assistant.trim().length > 0) this.memory.commit(text, assistant);
                        this.emit(signal);
                        subscription.unsubscribe();
                        resolve();
                        return;
                    }
                    this.emit(signal);
                },
                error: (error) => {
                    subscription.unsubscribe();
                    reject(error);
                },
            });
            void this.brain.run(this.memory.buildMessage(text)).catch((error) => {
                subscription.unsubscribe();
                reject(error);
            });
        });
    }
}
