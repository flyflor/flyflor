import { ChatRole, type BrainInput } from '@/neural/brain/types';
import { Workspace, type Intent } from '@/neural/workspace';
import { NeuralSignalType, TurnPreempted } from '@/neural/types';
import { FNeuron, Inject, Provide, Scope, type FCortexBus, type IObservable } from '@/core';
import type { AgentProfile } from '@/population/types';
import { Scratchpad } from './scratchpad';
import { Intelligence } from './intelligence/service';
import { Investigation } from './investigation';
import type { InvestigationOutcome } from './investigation/types';
import type { WorkspaceBrief } from '@/neural/workspace/types';

/**
 * EN: Brain is the single mind. It receives the semantic intent extracted by
 * Workspace. Intent classification lives solely in `Workspace.ingest` —
 * understanding is one cortical act, not two competing routers. `reply` and
 * `research` are handled locally; `coordinate` is forwarded to Cortex so the
 * cortex can dispatch parallel thought threads.
 * ZH: Brain 是单一心智。它接收 Workspace 提取的语义意图。意图分类唯一归属
 * `Workspace.ingest`——理解是一次皮层行为，不是两个互相竞争的路由器。`reply`、
 * `research` 在本地处理；`coordinate` 转发给 Cortex，由皮层派发并行思维线程。
 */
@Provide()
export class Brain extends FNeuron<BrainInput, string> implements IObservable<BrainInput, string> {
    @Inject()
    /** EN: Provider-facing intelligence service of the mind. ZH: 心智面向 provider 的智能服务。 */
    public intelligence!: Intelligence;

    @Scope()
    /** EN: Private scratchpad scoped to this thought thread. ZH: 该思维线程私有的作用域临时笔记缓存。 */
    public scratchpad!: Scratchpad;

    @Scope()
    /** EN: Tool-using research loop scoped to this thought thread. ZH: 该思维线程作用域内使用工具的研究循环。 */
    public investigation!: Investigation;

    constructor(
        cortex: FCortexBus,
        /** EN: Shared bounded semantic working set. ZH: 共享的有界语义工作集。 */
        public workspace: Workspace,
        /** EN: Population profile carried by this thought thread. ZH: 该思维线程携带的种群档案。 */
        public profile?: AgentProfile,
    ) {
        super(cortex);
    }

    /**
     * EN: Runs one whole user turn behind a single error boundary.
     * ZH: 在单一错误边界内运行一整个用户回合。
     *
     * EN: ingest, route, and the chosen handler all throw freely; the single error boundary in
     * `Cortex.runStimulus` (the call site of `brain.next`) receives the rejection and decides what the
     * user sees. `Brain` does not catch.
     * ZH: ingest、route 和选中的 handler 都可自由抛出;唯一错误边界在 `Cortex.runStimulus`
     * (调 `brain.next` 的地方),由它接住拒绝并决定给用户看什么。`Brain` 不做 catch。
     */
    public override async onPipe(data: BrainInput) {
        const input = { text: data.text, speakerId: data.speakerId, stimulusId: data.stimulusId };
        const turn = data.relation === 'same' && data.targetTurnId
            ? await this.workspace.revise(data.targetTurnId, input, data.signal)
            : await this.workspace.ingest(input, data.signal);
        data.signal?.throwIfAborted();
        this.scratchpad.ingestBrief?.(this.workspace.brief(turn.id));
        await this.handle(turn.intent, data.text, turn.id, data.signal, data.stimulusId);
    }

    private handle(intent: Intent, chunk: string, turnId: string, abortSignal?: AbortSignal, streamId?: string): Promise<void> {
        if (intent === 'reply') return this.reply(chunk, turnId, abortSignal, streamId);
        if (intent === 'coordinate') {
            if (!this.cortex.coordinate) throw Error('Coordinate boundary is missing');
            return this.cortex.coordinate(chunk, turnId, abortSignal, streamId);
        }
        return this.research(chunk, turnId, abortSignal, streamId);
    }

    private async reply(chunk: string, turnId: string, abortSignal?: AbortSignal, streamId?: string): Promise<void> {
        let assistant = '';
        const messages = [...this.scratchpad.buildMessages(), { role: ChatRole.User, content: chunk }];
        try {
            await this.intelligence.stream(messages, (delta) => {
                if (this.cortex.preempted?.(turnId)) throw new TurnPreempted(turnId);
                assistant += delta;
                this.cortex.emit(NeuralSignalType.Reply, { turnId, ...(streamId ? { streamId } : {}), chunk: delta });
            }, abortSignal);
        } catch (error) {
            if ((error instanceof TurnPreempted && error.turnId === turnId) || (abortSignal?.aborted && this.cortex.preempted?.(turnId))) {
                await this.workspace.interrupt(turnId, { assistant });
                if (!(error instanceof TurnPreempted)) throw new TurnPreempted(turnId);
            }
            throw error;
        }
        if (abortSignal?.aborted || this.cortex.preempted?.(turnId)) {
            await this.workspace.interrupt(turnId, { assistant });
            throw new TurnPreempted(turnId);
        }
        await this.workspace.settle(turnId, { assistant }, abortSignal);
        // If cancellation won before settlement, the settle call cannot leave a
        // working turn behind. If it did complete, completion won the race and
        // the terminal marker remains valid.
        const settled = this.workspace.turn(turnId);
        if (settled.status === 'working' && (abortSignal?.aborted || this.cortex.preempted?.(turnId))) throw new TurnPreempted(turnId);
        this.cortex.emit(NeuralSignalType.Reply, { turnId, ...(streamId ? { streamId } : {}), chunk: null });
    }

    private async research(chunk: string, turnId: string, abortSignal?: AbortSignal, streamId?: string): Promise<void> {
        const messages = [...this.scratchpad.buildMessages(), { role: ChatRole.User, content: chunk }];
        const turn = this.workspace.turn(turnId);
        const outcome = await this.investigation.run(messages, {
            turnId,
            ...(streamId ? { streamId } : {}),
            cwd: turn.cwd,
            ...(abortSignal ? { signal: abortSignal } : {}),
        });
        if (outcome.interrupted) {
            await this.workspace.interrupt(turnId, { assistant: '', evidence: outcome.evidence });
            throw new TurnPreempted(turnId);
        }
        if (outcome.paused) return;
        if (abortSignal?.aborted || this.cortex.preempted?.(turnId)) {
            await this.workspace.interrupt(turnId, { assistant: outcome.answer, evidence: outcome.evidence });
            throw new TurnPreempted(turnId);
        }
        await this.workspace.settle(turnId, { assistant: outcome.answer, evidence: outcome.evidence }, abortSignal);
        const settled = this.workspace.turn(turnId);
        if (settled.status === 'working' && (abortSignal?.aborted || this.cortex.preempted?.(turnId))) throw new TurnPreempted(turnId);
        this.cortex.emit(NeuralSignalType.Reply, { turnId, ...(streamId ? { streamId } : {}), chunk: null });
    }

    /**
     * EN: Parallel-thought understanding entry. Ingests the Workspace brief into
     * this thought thread's private scratchpad, then runs one investigation loop
     * without touching Workspace.turns.
     * ZH: 并行思维理解入口。把 Workspace 简报写入该思维线程的私有临时笔记，然后跑一轮
     * investigation，不修改 Workspace.turns。
     */
    public async understand(brief: WorkspaceBrief, signal?: AbortSignal): Promise<InvestigationOutcome | undefined> {
        this.scratchpad.ingestBrief(brief);
        const messages = this.scratchpad.buildMessages();
        const outcome = await this.investigation.run(messages, { emitReply: false, cwd: brief.cwd, signal });
        if (outcome.paused) return undefined;
        return outcome;
    }
}
