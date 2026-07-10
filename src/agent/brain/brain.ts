import { AgentChatRole } from '@/agent/types';
import { Context } from '@/agent/context';
import { SynapseSignalType } from '@/neural/types';
import { FAgentAtom, Inject, Prompt, PromptService, Provide, Scope, type IObservable } from '@/core';
import { parse } from '@/agent/json';
import { Memory } from '../memory';
import { Callosum } from './callosum';
import { CallosumSignalType, type CallosumSignal } from './callosum';
import { Intelligence } from './intelligence/service';
import { Investigation } from './investigation';
import type { InvestigationOutcome } from './investigation/types';
import type { AgentBrief } from '@/agent/context/types';

export enum BrainPrompt {
    Soul = 'SOUL',
}

/**
 * EN: Brain receives the routed intent from Callosum.
 * ZH: Brain 接收 Callosum 路由后的意图。
 *
 * EN: `reply`, `research`, `soul` are handled locally; `coordinate` is forwarded
 * to Synapse so the cortex can dispatch the agent pool.
 * ZH: `reply`、`research`、`soul` 在本地处理；`coordinate` 转发给 Synapse，由皮层派发 agent pool。
 */
@Provide()
export class Brain extends FAgentAtom<string, CallosumSignal> implements IObservable<string, CallosumSignal> {
    @Scope()
    public callosum!: Callosum;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<BrainPrompt>;

    @Scope()
    public intelligence!: Intelligence;

    @Inject()
    public context!: Context;

    @Scope()
    public memory!: Memory;

    @Scope()
    public investigation!: Investigation;

    /**
     * EN: Runs one whole user turn behind a single error boundary.
     * ZH: 在单一错误边界内运行一整个用户回合。
     *
     * EN: ingest, route, and the chosen handler all throw freely; the single error boundary in
     * `Synapse.input` (the call site of `agent.next`) receives the rejection and decides what the
     * user sees. `Brain` does not catch.
     * ZH: ingest、route 和选中的 handler 都可自由抛出;唯一错误边界在 `Synapse.input`
     * (调 `agent.next` 的地方),由它接住拒绝并决定给用户看什么。`Brain` 不做 catch。
     */
    public override async onPipe(data: string) {
        const turn = await this.context.ingest({ text: data });
        await this.handle(await this.callosum.route(data), turn.id);
    }

    private handle(signal: CallosumSignal, turnId: string): Promise<void> {
        if (signal.type === CallosumSignalType.Reply) return this.reply(signal, turnId);
        if (signal.type === CallosumSignalType.Soul) return this.soul(signal, turnId);
        if (signal.type === CallosumSignalType.Coordinate) {
            if (!this.synapse.coordinate) throw Error('Coordinate boundary is missing');
            return this.synapse.coordinate(signal, turnId);
        }
        return this.research(signal, turnId);
    }

    private async reply(signal: CallosumSignal, turnId: string): Promise<void> {
        let assistant = '';
        const messages = [...this.memory.buildMessage(), { role: AgentChatRole.User, content: String(signal.chunk) }];
        await this.intelligence.stream(messages, (chunk) => {
            assistant += chunk;
            this.synapse.emit(SynapseSignalType.Reply, chunk);
        });
        await this.context.settle(turnId, { assistant });
        this.synapse.emit(SynapseSignalType.Reply, null);
    }

    private async research(signal: CallosumSignal, turnId: string): Promise<void> {
        const messages = [...this.memory.buildMessage(), { role: AgentChatRole.User, content: String(signal.chunk) }];
        const turn = this.context.turn(turnId);
        const outcome = await this.investigation.run(signal, messages, { turnId, cwd: turn.cwd });
        if (outcome.paused) return;
        await this.context.settle(turnId, { assistant: outcome.answer, evidence: outcome.evidence });
        this.synapse.emit(SynapseSignalType.Reply, null);
    }

    private async soul(signal: CallosumSignal, turnId: string): Promise<void> {
        const pkg = this.memory.prompt;
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(BrainPrompt.Soul) },
            { role: AgentChatRole.User, content: `${pkg.render({ kind: 'document' })}\n<latest_user_message>${signal.chunk}</latest_user_message>` },
        ]);
        const plan = parse<{ writes?: Array<{ file?: string; content?: string }> }>(raw);
        const { written, rejected } = pkg.applyWrites(plan.writes ?? []);
        const assistant = `协议包已更新: ${written.join(', ') || '无'}${rejected.length ? `；已拒绝: ${rejected.join(', ')}` : ''}`;
        this.synapse.emit(SynapseSignalType.Reply, assistant);
        await this.context.settle(turnId, { assistant });
        this.synapse.emit(SynapseSignalType.Reply, null);
    }

    /**
     * EN: Worker understanding entry. Ingests the Context brief into this agent's
     * private memory, then runs one investigation loop without touching Context.turns.
     * ZH: worker 理解入口。把 Context 简报写入该 agent 的私有记忆，然后跑一轮
     * investigation，不修改 Context.turns。
     */
    public async understand(brief: AgentBrief): Promise<InvestigationOutcome | undefined> {
        this.memory.ingestBrief(brief);
        const messages = this.memory.buildMessage();
        const outcome = await this.investigation.run(
            { type: CallosumSignalType.Research, chunk: brief.goal },
            messages,
            { emitReply: false, cwd: brief.cwd },
        );
        if (outcome.paused) return undefined;
        return outcome;
    }
}
