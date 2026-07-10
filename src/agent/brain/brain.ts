import { AgentChatRole, type Assignment, type Outcome } from '@/agent/types';
import { Identity } from '@/agent/identity';
import { Memory } from '@/agent/memory';
import { Turn } from '@/agent/turn';
import { SynapseSignalType } from '@/neural/types';
import { FAgentAtom, Inject, Prompt, PromptService, Provide, Scope, type IObservable } from '@/core';
import { parse } from '@/agent/json';
import { Callosum } from './callosum';
import { Intelligence } from './intelligence/service';
import { Investigation } from './investigation';

export enum BrainPrompt {
    Soul = 'SOUL',
}

@Provide()
export class Brain extends FAgentAtom<string> implements IObservable<string> {
    @Scope()
    public callosum!: Callosum;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<BrainPrompt>;

    @Scope()
    public intelligence!: Intelligence;

    @Inject()
    public memory!: Memory;

    @Scope()
    public identity!: Identity;

    @Scope()
    public investigation!: Investigation;

    public override async onPipe(input: string): Promise<void> {
        let turn: Turn | undefined;
        try {
            const perception = await this.callosum.perceive(input, this.memory.recent());
            const active = this.memory.begin(input, perception);
            turn = active;
            await this.handle(active);
        } catch (error) {
            if (turn) this.memory.fail(turn.id, error);
            throw error;
        }
    }

    private handle(turn: Turn): Promise<void> {
        if (turn.perception.mode === 'reply') return this.reply(turn);
        if (turn.perception.mode === 'soul') return this.soul(turn);
        if (turn.perception.mode === 'coordinate') {
            if (!this.synapse.coordinate) throw Error('Coordinate boundary is missing');
            return this.synapse.coordinate(turn);
        }
        return this.research(turn);
    }

    private async reply(turn: Turn): Promise<void> {
        let answer = '';
        await this.intelligence.stream(this.messages(turn.input), (chunk) => {
            answer += chunk;
            this.synapse.emit(SynapseSignalType.Reply, chunk);
        });
        this.memory.complete(turn.id, answer);
        this.synapse.emit(SynapseSignalType.Reply, null);
    }

    private async research(turn: Turn): Promise<void> {
        const outcome = await this.investigation.run(this.messages(turn.input), {
            turnId: turn.id,
            cwd: turn.perception.cwd,
        });
        if (outcome.paused) return;
        this.memory.complete(turn.id, outcome.answer, outcome.evidence);
        this.synapse.emit(SynapseSignalType.Reply, null);
    }

    private async soul(turn: Turn): Promise<void> {
        const pkg = this.identity.prompt;
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(BrainPrompt.Soul) },
            { role: AgentChatRole.User, content: `${pkg.render({ kind: 'document' })}\n<latest_user_message>${turn.input}</latest_user_message>` },
        ]);
        const plan = parse<{ writes?: Array<{ file?: string; content?: string }> }>(raw);
        const { written, rejected } = pkg.applyWrites(plan.writes ?? []);
        const answer = `协议包已更新: ${written.join(', ') || '无'}${rejected.length ? `；已拒绝: ${rejected.join(', ')}` : ''}`;
        this.synapse.emit(SynapseSignalType.Reply, answer);
        this.memory.complete(turn.id, answer);
        this.synapse.emit(SynapseSignalType.Reply, null);
    }

    public async work(assignment: Assignment): Promise<Outcome | undefined> {
        const messages = [
            ...this.identity.messages(),
            {
                role: AgentChatRole.User,
                content: JSON.stringify({
                    goal: assignment.goal,
                    persona: assignment.persona,
                    constraints: assignment.constraints,
                    context: assignment.context,
                }),
            },
        ];
        const outcome = await this.investigation.run(messages, { emitReply: false, cwd: assignment.cwd });
        return outcome.paused ? undefined : { answer: outcome.answer, evidence: outcome.evidence };
    }

    private messages(input: string) {
        return [
            ...this.identity.messages(),
            ...this.memory.messages(),
            { role: AgentChatRole.User, content: input },
        ];
    }
}
