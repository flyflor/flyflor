import { AgentChatRole, type AgentInput } from '@/agent/types';
import { Context, type Intent } from '@/agent/context';
import { SynapseSignalType, TurnPreempted } from '@/neural/types';
import { FAgentAtom, Inject, Provide, Scope, type IObservable } from '@/core';
import { Memory } from '../memory';
import { Intelligence } from './intelligence/service';
import { Investigation } from './investigation';
import type { InvestigationOutcome } from './investigation/types';
import type { AgentBrief } from '@/agent/context/types';

/**
 * EN: Brain receives the semantic intent extracted by Context. Intent
 * classification lives solely in `Context.ingest` — understanding is one
 * cortical act, not two competing routers. `reply` and `research` are handled
 * locally; `coordinate` is forwarded to Synapse so the cortex can dispatch
 * the agent pool.
 * ZH: Brain 接收 Context 提取的语义意图。意图分类唯一归属 `Context.ingest`——
 * 理解是一次皮层行为，不是两个互相竞争的路由器。`reply`、`research` 在本地处理；
 * `coordinate` 转发给 Synapse，由皮层派发 agent pool。
 */
@Provide()
export class Brain extends FAgentAtom<AgentInput, string> implements IObservable<AgentInput, string> {
    @Scope()
    /** EN: Provider-facing intelligence service scoped to this agent. ZH: 该 agent 作用域内面向 provider 的智能服务。 */
    public intelligence!: Intelligence;

    @Inject()
    /** EN: Shared bounded semantic working set. ZH: 共享的有界语义工作集。 */
    public context!: Context;

    @Scope()
    /** EN: Private memory cache scoped to this agent. ZH: 该 agent 私有的作用域记忆缓存。 */
    public memory!: Memory;

    @Scope()
    /** EN: Tool-using research loop scoped to this agent. ZH: 该 agent 作用域内使用工具的研究循环。 */
    public investigation!: Investigation;

    /**
     * EN: Runs one whole user turn behind a single error boundary.
     * ZH: 在单一错误边界内运行一整个用户回合。
     *
     * EN: ingest, route, and the chosen handler all throw freely; the single error boundary in
     * `Synapse.runStimulus` (the call site of `agent.next`) receives the rejection and decides what the
     * user sees. `Brain` does not catch.
     * ZH: ingest、route 和选中的 handler 都可自由抛出;唯一错误边界在 `Synapse.runStimulus`
     * (调 `agent.next` 的地方),由它接住拒绝并决定给用户看什么。`Brain` 不做 catch。
     */
    public override async onPipe(data: AgentInput) {
        const input = { text: data.text, speakerId: data.speakerId, stimulusId: data.stimulusId };
        const turn = data.relation === 'same' && data.targetTurnId
            ? await this.context.revise(data.targetTurnId, input, data.signal)
            : await this.context.ingest(input, data.signal);
        data.signal?.throwIfAborted();
        this.memory.ingestBrief?.(this.context.brief(turn.id));
        await this.handle(turn.intent, data.text, turn.id, data.signal, data.stimulusId);
    }

    private handle(intent: Intent, chunk: string, turnId: string, abortSignal?: AbortSignal, streamId?: string): Promise<void> {
        if (intent === 'reply') return this.reply(chunk, turnId, abortSignal, streamId);
        if (intent === 'coordinate') {
            if (!this.synapse.coordinate) throw Error('Coordinate boundary is missing');
            return this.synapse.coordinate(chunk, turnId, abortSignal, streamId);
        }
        return this.research(chunk, turnId, abortSignal, streamId);
    }

    private async reply(chunk: string, turnId: string, abortSignal?: AbortSignal, streamId?: string): Promise<void> {
        let assistant = '';
        const messages = [...this.memory.buildMessage(), { role: AgentChatRole.User, content: chunk }];
        try {
            await this.intelligence.stream(messages, (delta) => {
                if (this.synapse.preempted?.(turnId)) throw new TurnPreempted(turnId);
                assistant += delta;
                this.synapse.emit(SynapseSignalType.Reply, { turnId, ...(streamId ? { streamId } : {}), chunk: delta });
            }, abortSignal);
        } catch (error) {
            if ((error instanceof TurnPreempted && error.turnId === turnId) || (abortSignal?.aborted && this.synapse.preempted?.(turnId))) {
                await this.context.interrupt(turnId, { assistant });
                if (!(error instanceof TurnPreempted)) throw new TurnPreempted(turnId);
            }
            throw error;
        }
        if (abortSignal?.aborted || this.synapse.preempted?.(turnId)) {
            await this.context.interrupt(turnId, { assistant });
            throw new TurnPreempted(turnId);
        }
        await this.context.settle(turnId, { assistant }, abortSignal);
        // If cancellation won before settlement, the settle call cannot leave a
        // working turn behind. If it did complete, completion won the race and
        // the terminal marker remains valid.
        const settled = this.context.turn(turnId);
        if (settled.status === 'working' && (abortSignal?.aborted || this.synapse.preempted?.(turnId))) throw new TurnPreempted(turnId);
        this.synapse.emit(SynapseSignalType.Reply, { turnId, ...(streamId ? { streamId } : {}), chunk: null });
    }

    private async research(chunk: string, turnId: string, abortSignal?: AbortSignal, streamId?: string): Promise<void> {
        const messages = [...this.memory.buildMessage(), { role: AgentChatRole.User, content: chunk }];
        const turn = this.context.turn(turnId);
        const outcome = await this.investigation.run(messages, {
            turnId,
            ...(streamId ? { streamId } : {}),
            cwd: turn.cwd,
            ...(abortSignal ? { signal: abortSignal } : {}),
        });
        if (outcome.interrupted) {
            await this.context.interrupt(turnId, { assistant: '', evidence: outcome.evidence });
            throw new TurnPreempted(turnId);
        }
        if (outcome.paused) return;
        if (abortSignal?.aborted || this.synapse.preempted?.(turnId)) {
            await this.context.interrupt(turnId, { assistant: outcome.answer, evidence: outcome.evidence });
            throw new TurnPreempted(turnId);
        }
        await this.context.settle(turnId, { assistant: outcome.answer, evidence: outcome.evidence }, abortSignal);
        const settled = this.context.turn(turnId);
        if (settled.status === 'working' && (abortSignal?.aborted || this.synapse.preempted?.(turnId))) throw new TurnPreempted(turnId);
        this.synapse.emit(SynapseSignalType.Reply, { turnId, ...(streamId ? { streamId } : {}), chunk: null });
    }

    /**
     * EN: Worker understanding entry. Ingests the Context brief into this agent's
     * private memory, then runs one investigation loop without touching Context.turns.
     * ZH: worker 理解入口。把 Context 简报写入该 agent 的私有记忆，然后跑一轮
     * investigation，不修改 Context.turns。
     */
    public async understand(brief: AgentBrief, signal?: AbortSignal): Promise<InvestigationOutcome | undefined> {
        this.memory.ingestBrief(brief);
        const messages = this.memory.buildMessage();
        const outcome = await this.investigation.run(messages, { emitReply: false, cwd: brief.cwd, signal });
        if (outcome.paused) return undefined;
        return outcome;
    }
}
