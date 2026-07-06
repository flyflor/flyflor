import { AgentChatRole } from '@/agent/types';
import { Context, type Summary } from '@/agent/context';
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

    @Inject()
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
        await this.context.ingest({ text: data });
        await this.handle(await this.callosum.route(data));
    }

    private handle(signal: CallosumSignal): Promise<void> {
        if (signal.type === CallosumSignalType.Reply) return this.reply(signal);
        if (signal.type === CallosumSignalType.Soul) return this.soul(signal);
        if (signal.type === CallosumSignalType.Coordinate) {
            // EN: The cortex (Synapse) owns agent-pool dispatch, not the local Brain.
            // ZH: 皮层（Synapse）负责 agent pool 派发，本地 Brain 只转发信号。
            this.synapse.emit(SynapseSignalType.Coordinate, signal);
            return Promise.resolve();
        }
        return this.research(signal);
    }

    private async reply(signal: CallosumSignal): Promise<void> {
        let assistant = '';
        await this.intelligence.stream(this.memory.buildMessage(), (chunk) => {
            assistant += chunk;
            this.synapse.emit(SynapseSignalType.Reply, chunk);
        });
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ assistant });
    }

    private async research(signal: CallosumSignal): Promise<void> {
        const messages = this.memory.buildMessage();
        const outcome = await this.investigation.run(signal, messages);
        if (outcome.paused) return;
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ assistant: outcome.answer, evidence: outcome.evidence });
    }

    private async soul(signal: CallosumSignal): Promise<void> {
        const pkg = this.memory.prompt;
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(BrainPrompt.Soul) },
            { role: AgentChatRole.User, content: `${pkg.render({ kind: 'document' })}\n<latest_user_message>${signal.chunk}</latest_user_message>` },
        ]);
        const plan = parse<{ writes?: Array<{ file?: string; content?: string }> }>(raw);
        const { written, rejected } = pkg.applyWrites(plan.writes ?? []);
        const assistant = `协议包已更新: ${written.join(', ') || '无'}${rejected.length ? `；已拒绝: ${rejected.join(', ')}` : ''}`;
        this.synapse.emit(SynapseSignalType.Reply, assistant);
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ assistant });
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
        const outcome = await this.investigation.run({ type: CallosumSignalType.Research, chunk: brief.goal }, messages);
        if (outcome.paused) return undefined;
        return outcome;
    }
}