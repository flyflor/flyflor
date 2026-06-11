import { Inject, Provide, FAgent } from '@/core';
import { Brain } from './brain';
import { Memory } from './memory';
import { Callosal, CallosalAction, type CallosalTurn } from './callosal';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import type { AgentMemory } from './brain/intelligence';

/**
 * The agent: a person-like runtime object. It owns an injected brain (cortex) and memory (prefrontal
 * cache), and is itself the `Subject` the neural layer subscribes to for streamed output.
 *
 * `next()` is the turn owner: it asks memory for the assembled mental input, streams the brain's
 * reflex out chunk by chunk, and commits the finished turn to memory only on success.
 */
@Provide()
export class Agent extends FAgent<string> {
    @Inject(function (this: Agent) {
        return this.agentConfig;
    })
    public brain!: Brain;

    @Inject(function (this: Agent) {
        return this.agentConfig;
    })
    public memory!: Memory;

    @Inject(function (this: Agent) {
        return this.agentConfig;
    })
    public callosal!: Callosal;

    @Inject()
    public config!: ConfigComponent;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    public override async next(text: string) {
        this.log.debug('turn.start', text);
        const callosal = await this.callosal.navigate(this.memory.buildMessage(text));
        this.log.debug('turn.callosal', callosal);

        if (callosal.action === CallosalAction.REMEMBER) return this.remember(text, callosal.content);
        if (callosal.action === CallosalAction.RESEARCH) return this.research(callosal.content);
        if (callosal.action === CallosalAction.DIALOGUE) return this.dialogue(text);
        return false;
    }

    public async remember(text: string, reply: string) {
        this.log.debug('turn.remember', text, reply);
        this.memory.commit(text, reply);
        super.next(reply);
        return true;
    }

    public async research(direction: string) {
        this.log.debug('turn.execute', direction);
        await this.callosal.research(direction)
        return true;
    }

    public async dialogue(text: string) {
        const messages = this.memory.buildMessage(text);
        const message = await new Promise<string>((resolve, reject) => {
            const content: string[] = [];
            this.brain.transform(messages).subscribe({
                next: (signal) => {
                    if (signal.type !== 'delta') return;
                    content.push(signal.text);
                    super.next(content.join(''));
                },
                error: reject,
                complete: () => resolve(content.join('')),
            });
        });
        this.memory.commit(text, message);
        return true;
    }
}
