import { Inject, Provide, FAgent } from '@/core';
import { Brain } from './brain';
import { Memory } from './memory';
import { Callosal, CallosalAction, type CallosalTurn } from './callosal';
import { Execution } from './execution';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import { EnvironmentService } from '@/core';
import type { AgentChatRole } from './brain/intelligence';

/**
 * The agent: a person-like runtime object. It owns a brain (cortex), memory (prefrontal cache),
 * callosal (corpus callosum route/scheduler), and execution (motor cortex/tool loop). The agent
 * is itself the `Subject` the neural layer subscribes to for streamed output.
 *
 * Three turn paths, determined by the callosal navigation:
 *   1. Reply — the protocol package was updated, the turn is already answered.
 *   2. Chat — a direct reflex through the brain's inference stream.
 *   3. Execute — the distilled brief enters the execution tool loop.
 *
 * Each path that produces a final user-facing answer commits the turn to memory.
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
    public execution!: Execution;

    @Inject()
    public environment!: EnvironmentService;

    @Inject()
    public config!: ConfigComponent;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    public override async next(text: string): Promise<boolean> {
        this.log.debug('turn.start', text);
        const callosal = await this.callosal.navigate(text);
        this.log.debug('turn.callosal', callosal);

        if (callosal.action === CallosalAction.Reply) return this.reply(text, callosal);
        if (callosal.action === CallosalAction.Chat) return this.dialogue(text);
        if (callosal.action === CallosalAction.Execute) return this.execute(text, callosal);
        return false;
    }

    /**
     * Reply path: the callosal updated the protocol package and already has a user-facing answer.
     */
    public async reply(text: string, callosal: CallosalTurn): Promise<boolean> {
        this.log.debug('turn.reply', text, callosal.reply);
        const answer = callosal.reply ?? callosal.content;
        this.memory.commit(text, answer);
        super.next(answer);
        return true;
    }

    /**
     * Execute path: the callosal distilled a brief; hand it to the execution loop.
     * Commits only on a successful final — ask/confirm/max-iterations produce output but do not commit
     * (their result is a hand-off, not a concluded turn).
     */
    public async execute(text: string, callosal: CallosalTurn): Promise<boolean> {
        this.log.debug('turn.execute', callosal.brief);
        const summary = this.environment.render();
        const history = this.memory.buildMessage(callosal.brief?.instructions ?? callosal.content);
        const preamble = [...history, { role: 'system' as AgentChatRole, content: summary }];
        const result = await this.execution.run(callosal.brief?.instructions ?? callosal.content, preamble);
        this.log.debug('turn.result', result);
        super.next(result.text);
        if (result.ok && result.reason === 'final') {
            this.memory.commit(text, result.text);
        }
        return true;
    }

    /**
     * Chat path: stream the brain's inference reflex.
     */
    public async dialogue(text: string): Promise<boolean> {
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
