import type { SocketPacket } from '@/neural/ipc';
import type { ConfigService } from '@/configuration';
import type { Context } from '@/agent/context';
import type { Intelligence } from '@/agent/brain/intelligence';
import { Config, Inject, Prompt, PromptService, Singleton } from '@/core';
import { FService } from '@/core/ioc';
import { parse } from '@/agent/json';
import type { Synapse } from '@/neural/synapse';
import type { InteractionResponse } from '@/neural/types';
import { AgentChatRole } from '@/agent/types';
import {
    DispositionRelation,
    type AttentionInstruction,
    type Disposition,
    type Stimulus,
} from './types';

interface BufferedChunk {
    speakerId: string;
    streamId?: string;
    chunks: string[];
    streamEnd: boolean;
}

interface Mouthful {
    speakerId: string;
    text: string;
}

/**
 * EN: The small protocol Awareness needs from the cortex.  `revise` and `cancel`
 * are optional while Synapse is being migrated; the attention instruction is
 * also attached to the routed stimulus so an older cortex can safely ignore
 * the extra argument and a newer one can route it to Context.revise().
 * ZH: Awareness 需要皮层提供的最小协议。在 Synapse 迁移期间 `revise` 与 `cancel`
 * 为可选；注意指令也会附加在路由出去的刺激上，旧皮层可以安全忽略这个额外参数，
 * 新皮层则可以将其路由到 Context.revise()。
 */
interface AwarenessCortex {
    /** EN: Routes one attended stimulus into the cortex's foreground stream. ZH: 把一条已注意的刺激路由进皮层的前台流。 */
    attend(stimulus: Stimulus, instruction?: AttentionInstruction): Promise<void> | void;
    /** EN: Routes a same-thread revision to an existing Turn. ZH: 把同线程修订路由到已有 Turn。 */
    revise?(stimulus: Stimulus, targetTurnId: string): Promise<void> | void;
    /** EN: Cancels provider work for a Turn marked urgent. ZH: 取消被标记紧急的 Turn 的提供方工作。 */
    cancel?(turnId: string): Promise<void> | void;
    /** EN: Releases cortex-side state of a disconnected speaker. ZH: 释放已断开说话人在皮层侧的状态。 */
    forgetSpeaker?(speakerId: string): Promise<void> | void;
    /** EN: Forwards a speaker's answer to a pending interaction. ZH: 把说话人的答复转发给待处理的交互。 */
    answer(turnId: string, id: string, response: InteractionResponse, speakerId?: string): void;
    /** EN: Motor output: writes one packet back to a speaker. ZH: 运动输出：向说话人写回一个包。 */
    deliver(speakerId: string, packet: SocketPacket): void;
}

/**
 * EN: Awareness is the life-form's attention gate.  It keeps one bounded,
 * serial foreground stream: pending stimuli stay FIFO, a same-thread stimulus
 * revises an existing semantic Turn, and only an explicitly urgent stimulus
 * may request pre-emption.  There are no cross-stimulus background workers.
 * ZH: Awareness 是生命体的注意门。它维护一条有界、串行的前台流：待处理刺激保持
 * FIFO，同线程刺激原地修订已有语义 Turn，只有明确的紧急刺激才能请求抢占。
 * 不再为不同外部刺激启动后台 worker。
 */
@Singleton()
export class Awareness extends FService {
    /** EN: Fallback pending-stimulus capacity when config omits it. ZH: 配置缺省时的待处理刺激容量兜底值。 */
    public static readonly DefaultPendingCapacity = 32;
    /** EN: Backpressure notice sent when the attention queue is full. ZH: 注意队列满时发送的背压提示。 */
    public static readonly QueueBackpressureMessage = 'Attention queue is full; retry after the current work settles.';
    /** EN: Backpressure notice sent when the semantic workspace is full. ZH: 语义工作区满时发送的背压提示。 */
    public static readonly WorkspaceBackpressureMessage = 'Semantic workspace is full; revise existing work or retry later.';

    /** EN: Runtime configuration injected from the IOC container. ZH: 由 IOC 容器注入的运行时配置。 */
    @Config()
    public config!: ConfigService;

    /** EN: Semantic workspace consulted for Turn state and capacity. ZH: 用于查询 Turn 状态与容量的语义工作区。 */
    @Inject()
    public context!: Context;

    /** EN: Intelligence provider used for scheduling verdicts. ZH: 用于生成调度判决的智能提供方。 */
    @Inject()
    public intelligence!: Intelligence;

    /** EN: Prompt template for the scheduler LLM. ZH: 调度 LLM 的提示词模板。 */
    @Prompt('prompts/awareness')
    public prompt!: PromptService;

    private cortex?: AwarenessCortex;
    private sequence: number;
    private stimuli: Stimulus[];
    private pendingMain?: Stimulus;
    private mouthOwner?: string;
    private mouthQueue: Mouthful[];
    private bufferedChunks: Map<string, BufferedChunk>;
    private streamState: Map<string, { speakerId: string; streamId?: string; ended: boolean }>;
    private preemptFlags: Set<string>;
    private forgottenSpeakers: Set<string>;
    private batchTimer?: ReturnType<typeof setTimeout>;
    private scheduling: boolean;
    private scheduleAgain: boolean;

    constructor() {
        super();
        // EN: Monotonic id source for perceived stimuli. ZH: 感知刺激的单调 id 来源。
        this.sequence = 0;
        // EN: FIFO queue of stimuli awaiting a scheduling verdict. ZH: 等待调度判决的刺激 FIFO 队列。
        this.stimuli = [];
        // EN: Full texts waiting for the single mouth to free up. ZH: 等待单口空闲的完整文本队列。
        this.mouthQueue = [];
        // EN: Chunks held while another Turn owns the mouth. ZH: 其他 Turn 占用单口时暂存的分片。
        this.bufferedChunks = new Map();
        // EN: Per-Turn stream generation and ended state. ZH: 每个 Turn 的流代次与结束状态。
        this.streamState = new Map();
        // EN: Turn ids marked urgent and awaiting cancellation. ZH: 被标记紧急、等待取消的 Turn id。
        this.preemptFlags = new Set();
        // EN: Tombstoned speakers whose work is still settling. ZH: 已离开但工作仍在收尾的说话人墓碑。
        this.forgottenSpeakers = new Set();
        // EN: Reentrancy guard for the async scheduler. ZH: 异步调度器的重入守卫。
        this.scheduling = false;
        // EN: Requests one more scheduling pass after the current run. ZH: 请求本轮调度结束后再跑一轮。
        this.scheduleAgain = false;
    }

    /**
     * EN: Attaches the cortex so Awareness can route attended stimuli, cancels,
     * answers, and motor output through it.
     * ZH: 挂载皮层，使 Awareness 经它路由已注意的刺激、取消、答复和运动输出。
     */
    public attend(cortex: Synapse): void {
        this.cortex = cortex as unknown as AwarenessCortex;
    }

    /**
     * EN: Records one external stimulus. Arrival order is the default ordering;
     * the scheduler can only promote an entry when it marks it urgent. Returns
     * undefined when the pending queue is at capacity (backpressure).
     * ZH: 记录一条外部刺激。到达顺序即默认排序；调度器只能在标记紧急时提升某条。
     * 待处理队列满（背压）时返回 undefined。
     */
    public perceive(input: { speakerId: string; text: string }): Stimulus | undefined {
        const capacity = this.pendingCapacity();
        if (this.stimuli.length >= capacity) {
            this.log.warn('awareness.backpressure', {
                speakerId: input.speakerId,
                pending: this.stimuli.length,
                capacity,
            });
            this.deliver(input.speakerId, {
                action: 'error',
                data: Awareness.QueueBackpressureMessage,
            });
            return undefined;
        }
        this.forgottenSpeakers.delete(input.speakerId);
        this.sequence += 1;
        const stimulus: Stimulus = { id: `stim_${this.sequence}`, ...input, ts: Date.now() };
        this.stimuli.push(stimulus);
        this.scheduleSoon();
        return stimulus;
    }

    /**
     * EN: Drops all pending/output state belonging to a disconnected speaker. An
     * active working turn is retained until its cancellation callback settles,
     * so Context does not race the cortex's interrupt/settle path; inactive
     * turns are removed immediately.
     * ZH: 丢弃某个已断开说话人的全部待处理/输出状态。活跃的进行中 Turn 会保留到
     * 其取消回调收尾，避免 Context 与皮层的打断/收尾路径竞争；非活跃 Turn 立即移除。
     */
    public forget(speakerId: string): void {
        this.forgottenSpeakers.add(speakerId);
        this.stimuli = this.stimuli.filter((stimulus) => stimulus.speakerId !== speakerId);
        this.mouthQueue = this.mouthQueue.filter((mouthful) => mouthful.speakerId !== speakerId);
        const ownedMouth = this.mouthOwner
            && (this.streamState.get(this.mouthOwner)?.speakerId === speakerId
                || this.context?.turns.find((turn) => turn.id === this.mouthOwner)?.speakerId === speakerId)
            ? this.mouthOwner
            : undefined;
        for (const [turnId, buffer] of this.bufferedChunks) {
            if (buffer.speakerId === speakerId) this.bufferedChunks.delete(turnId);
        }
        for (const [turnId, state] of this.streamState) {
            if (state.speakerId === speakerId) this.streamState.delete(turnId);
        }
        const active = this.foregroundTurn();
        if (active?.speakerId === speakerId && active.status === 'working') {
            this.preemptFlags.add(active.id);
            void this.cortex?.cancel?.(active.id);
            void this.cortex?.forgetSpeaker?.(speakerId);
        } else {
            // A waiting Turn may already own the mouth even though it no longer
            // counts as working. Release that lock before deleting its Context
            // state, or every later speaker would remain buffered forever.
            if (ownedMouth !== undefined) {
                this.terminateInterruptedStream(ownedMouth);
                this.bufferedChunks.delete(ownedMouth);
                this.mouthOwner = undefined;
                this.flushBufferedChunks();
                this.flushMouthQueue();
            }
            // Let the cortex reject any interaction waiter before removing its
            // Context turn; otherwise a disconnected waiting turn can leave a
            // promise unresolved forever.
            void this.cortex?.forgetSpeaker?.(speakerId);
            this.context?.forgetSpeaker(speakerId);
        }
        this.pruneStreamState();
        this.releaseForgottenSpeaker(speakerId);
        this.scheduleSoon();
    }

    /**
     * EN: Forwards an answer to a pending ask/confirm, bypassing stimulus
     * scheduling. New socket adapters may pass the connection speakerId; when
     * present ownership is enforced before forwarding to the cortex.
     * ZH: 转发待处理 ask/confirm 的答复，绕过刺激调度。新的 socket 适配器可传入连接
     * 的 speakerId；传入时会先校验归属再转发给皮层。
     */
    public answer(turnId: string, id: string, response: unknown, speakerId?: string): void {
        if (speakerId !== undefined) {
            const turn = this.context?.turns.find((candidate) => candidate.id === turnId);
            if (!turn || turn.speakerId !== speakerId) throw Error(`Answer does not belong to speaker: ${turnId}`);
        }
        this.cortex?.answer(turnId, id, response as InteractionResponse, speakerId);
    }

    /** EN: Whether the Turn has been marked urgent and is awaiting cancellation. ZH: 该 Turn 是否已被标记紧急、正等待取消。 */
    public preempted(turnId: string): boolean {
        return this.preemptFlags.has(turnId);
    }

    /**
     * EN: Called by the cortex after it has compacted an interrupted Turn. A
     * stream cannot be retracted, so an interruption is explicitly terminated
     * on the wire before the next foreground stream is released.
     * ZH: 皮层压缩完被打断的 Turn 后调用。流无法撤回，因此在释放下一条前台流之前，
     * 必须先在线上显式终止被打断的流。
     */
    public turnInterrupted(turnId: string): void {
        this.preemptFlags.delete(turnId);
        const interrupted = this.context?.turns.find((turn) => turn.id === turnId);
        if (this.pendingMain && this.context?.turnForStimulus(this.pendingMain.id)?.id === turnId) {
            this.pendingMain = undefined;
        }
        this.terminateInterruptedStream(turnId);
        this.bufferedChunks.delete(turnId);
        if (this.mouthOwner === turnId) this.mouthOwner = undefined;
        this.flushBufferedChunks();
        this.flushMouthQueue();
        if (interrupted && this.forgottenSpeakers.has(interrupted.speakerId)) {
            this.context?.forgetSpeaker(interrupted.speakerId);
        }
        this.pruneStreamState();
        if (interrupted) this.releaseForgottenSpeaker(interrupted.speakerId);
        this.scheduleSoon();
    }

    /**
     * EN: Notifies the gate that a Turn settled; clears stale urgent flags,
     * releases forgotten-speaker tombstones, and schedules the next pass.
     * ZH: 通知注意门某个 Turn 已收尾；清除过期的紧急标记、释放已离开说话人的墓碑，
     * 并调度下一轮。
     */
    public turnSettled(turnId: string): void {
        const turn = this.context?.turns.find((candidate) => candidate.id === turnId || candidate.stimulusId === turnId);
        // If normal completion won a race with an urgent request, discard the
        // stale flag so it cannot survive as hidden state after this Turn ends.
        if (!turn || turn.status === 'completed' || turn.status === 'suspended') this.preemptFlags.delete(turn?.id ?? turnId);
        if (turn && this.forgottenSpeakers.has(turn.speakerId)) this.context?.forgetSpeaker(turn.speakerId);
        this.pruneStreamState();
        if (turn) this.releaseForgottenSpeaker(turn.speakerId);
        this.scheduleSoon();
    }

    /**
     * EN: Notifies the gate that a Turn paused at an interaction boundary; the
     * attend promise remains the foreground lock, so this only lets a pending
     * urgent verdict be considered after the interaction resumes.
     * ZH: 通知注意门某个 Turn 在交互边界暂停；attend promise 仍是前台锁，因此这里只是
     * 让待处理的紧急判决在交互恢复后可被考虑。
     */
    public turnPaused(_turnId: string): void {
        // The attend promise remains the foreground lock while an interaction
        // is waiting.  Scheduling here only lets a pending urgent verdict be
        // considered after the interaction is resumed.
        this.scheduleSoon();
    }

    /**
     * EN: One turn may stream at a time. Chunks from another turn are retained
     * in arrival order until the current stream ends. `chunk === null` ends the
     * owning stream and releases the mouth to buffered chunks and the queue.
     * ZH: 同一时刻只允许一个 Turn 推流。其他 Turn 的分片按到达顺序保留，直到当前流
     * 结束。`chunk === null` 结束持有者的流，并把单口让给缓冲分片和队列。
     */
    public speak(turnId: string, speakerId: string, chunk: string | null, streamId?: string): void {
        // A disconnected speaker is tombstoned until its active Turn has
        // finished cancellation. Late provider chunks must be discarded before
        // they can reacquire the single mouth and strand every other speaker.
        if (this.forgottenSpeakers.has(speakerId)) return;
        const owner = this.context?.turns.find((turn) => turn.id === turnId);
        if (owner && owner.speakerId !== speakerId) {
            this.log.warn('awareness.speaker_mismatch', { turnId, speakerId });
            return;
        }
        const previous = this.streamState.get(turnId);
        if (previous?.speakerId !== undefined && previous.speakerId !== speakerId) {
            this.log.warn('awareness.stream_speaker_mismatch', { turnId, speakerId });
            return;
        }
        if (previous?.ended) {
            // A Turn id survives same-thread revision. A new stream generation
            // must therefore reopen the mouth; a repeated terminal packet from
            // the old generation remains ignored.
            if (streamId !== undefined && previous.streamId === streamId) return;
            if (streamId === undefined && chunk === null) return;
            this.bufferedChunks.delete(turnId);
        } else if (previous && streamId !== undefined && previous.streamId !== undefined && previous.streamId !== streamId) {
            // A late chunk from an older generation must not corrupt the active
            // stream. The new generation is admitted after the old one ends.
            return;
        }
        const state = previous?.ended
            ? { speakerId, streamId, ended: false }
            : previous ?? { speakerId, streamId, ended: false };
        if (state.streamId === undefined && streamId !== undefined) state.streamId = streamId;
        this.streamState.set(turnId, state);

        if (this.mouthOwner === undefined || this.mouthOwner === turnId) {
            this.mouthOwner = turnId;
            if (chunk === null) {
                this.deliver(speakerId, { action: 'streamEnd', data: true });
                state.ended = true;
                this.mouthOwner = undefined;
                this.flushBufferedChunks();
                this.flushMouthQueue();
                return;
            }
            this.deliver(speakerId, { action: 'agent', data: chunk });
            return;
        }

        const buffer = this.bufferedChunks.get(turnId) ?? { speakerId, streamId: state.streamId, chunks: [], streamEnd: false };
        if (chunk === null) buffer.streamEnd = true;
        else buffer.chunks.push(chunk);
        this.bufferedChunks.set(turnId, buffer);
    }

    private terminateInterruptedStream(turnId: string): void {
        const state = this.streamState.get(turnId);
        if (state?.ended) return;
        const speakerId = state?.speakerId
            ?? this.context?.turns.find((turn) => turn.id === turnId)?.speakerId
            ?? (this.pendingMain?.id === turnId ? this.pendingMain.speakerId : undefined);
        if (!speakerId) return;
        const current = state ?? { speakerId, ended: false };
        this.streamState.set(turnId, current);
        this.deliver(speakerId, { action: 'interrupted', data: true });
        this.deliver(speakerId, { action: 'streamEnd', data: true });
        current.ended = true;
    }

    private flushBufferedChunks(): void {
        if (this.mouthOwner !== undefined) return;
        const next = this.bufferedChunks.entries().next().value as [string, BufferedChunk] | undefined;
        if (!next) return;
        const [turnId, buffer] = next;
        this.bufferedChunks.delete(turnId);
        this.mouthOwner = turnId;
        const state = this.streamState.get(turnId) ?? { speakerId: buffer.speakerId, streamId: buffer.streamId, ended: false };
        this.streamState.set(turnId, state);
        for (const chunk of buffer.chunks) {
            if (!state.ended) this.deliver(buffer.speakerId, { action: 'agent', data: chunk });
        }
        if (buffer.streamEnd && !state.ended) {
            this.deliver(buffer.speakerId, { action: 'streamEnd', data: true });
            state.ended = true;
        }
        this.mouthOwner = undefined;
        this.flushBufferedChunks();
        this.flushMouthQueue();
    }

    /**
     * EN: Compatibility boundary for an already-computed full answer. External
     * stimuli never use this path for parallel thinking; it simply obeys the
     * same one-mouth queue.
     * ZH: 已算好完整答复的兼容边界。外部刺激不会用这条路径做并行思考；它只是遵守
     * 同一个单口队列。
     */
    public say(speakerId: string, text: string): void {
        if (this.forgottenSpeakers.has(speakerId)) return;
        this.mouthQueue.push({ speakerId, text });
        this.flushMouthQueue();
    }

    private deliver(speakerId: string, packet: SocketPacket): void {
        if (this.forgottenSpeakers.has(speakerId)) return;
        this.cortex?.deliver(speakerId, packet);
    }

    private scheduleSoon(): void {
        // Keep a fixed coalescing window. Resetting the timer for every arrival
        // would let a sustained stimulus stream postpone attention forever.
        if (this.batchTimer !== undefined) return;
        const delay = this.config?.awareness?.batchWindowMs ?? 0;
        this.batchTimer = setTimeout(() => {
            this.batchTimer = undefined;
            void this.schedule();
        }, delay);
    }

    private async schedule(): Promise<void> {
        if (this.scheduling) {
            this.scheduleAgain = true;
            return;
        }
        this.scheduling = true;
        try {
            await this.runSchedule();
        } finally {
            this.scheduling = false;
            if (this.scheduleAgain) {
                this.scheduleAgain = false;
                this.scheduleSoon();
            }
        }
    }

    private async runSchedule(): Promise<void> {
        if (!this.cortex || this.pendingMain || this.stimuli.length === 0) return;
        const runnable = [...this.stimuli];
        const active = this.foregroundTurn();
        const dispositions = await this.scheduleWithModel(runnable);
        const live = runnable.filter((stimulus) => this.isPending(stimulus));
        if (live.length === 0) return;
        const decision = this.selectDisposition(live, dispositions, active);
        if (active) {
            if (decision?.disposition.urgent
                && (active.status === 'working' || active.status === 'waiting')
                && this.targets(active, decision.disposition)) {
                this.preemptFlags.add(active.id);
                void this.cortex.cancel?.(active.id);
            }
            return;
        }

        if (!decision) {
            this.dispatchMain(live[0]!, this.fallbackDisposition(live[0]!));
            return;
        }
        this.applyIdleDisposition(decision.stimulus, decision.disposition);
    }

    private foregroundTurn() {
        const turns = this.context?.turns ?? [];
        return turns.findLast((turn) => turn.status === 'working' || turn.status === 'waiting');
    }

    private async scheduleWithModel(runnable: Stimulus[]): Promise<Disposition[]> {
        const turns = this.context?.turns ?? [];
        if (turns.length === 0 && runnable.length === 1) return [];
        const payload = {
            workspace: turns.map((turn) => ({
                turnId: turn.id,
                speakerId: turn.speakerId,
                status: turn.status,
                intent: turn.intent,
                goal: turn.goal,
                paused: turn.pause?.kind ?? null,
                done: turn.done,
                open: turn.open,
                outcome: turn.summary ?? null,
            })),
            stimuli: runnable.map((stimulus) => ({ id: stimulus.id, speakerId: stimulus.speakerId, text: stimulus.text })),
        };
        try {
            const controller = new AbortController();
            const raw = await this.withTimeout(
                this.intelligence.completeText([
                    { role: AgentChatRole.System, content: this.prompt.section('SCHEDULE') },
                    { role: AgentChatRole.User, content: JSON.stringify(payload) },
                ], controller.signal),
                this.config?.awareness?.scheduleTimeoutMs ?? 8000,
                () => controller.abort(),
            );
            const parsed = parse<unknown>(raw);
            if (!this.isRecord(parsed) || !Array.isArray(parsed.dispositions)) return [];
            const ids = new Set(runnable.map((stimulus) => stimulus.id));
            const seen = new Set<string>();
            return parsed.dispositions.flatMap((item) => {
                const disposition = this.parseDisposition(item);
                if (!disposition || !ids.has(disposition.stimulusId) || seen.has(disposition.stimulusId)) return [];
                seen.add(disposition.stimulusId);
                return [disposition];
            });
        } catch (error) {
            this.log.warn('awareness.schedule.timeout', { name: error instanceof Error ? error.name : 'UnknownError' });
            return [];
        }
    }

    private parseDisposition(value: unknown): Disposition | undefined {
        if (!this.isRecord(value) || typeof value.stimulusId !== 'string') return undefined;
        if (value.relation !== DispositionRelation.Same && value.relation !== DispositionRelation.New) return undefined;
        if (value.targetTurnId !== undefined && typeof value.targetTurnId !== 'string') return undefined;
        if (value.urgent !== undefined && typeof value.urgent !== 'boolean') return undefined;
        if (value.relation === DispositionRelation.Same && typeof value.targetTurnId !== 'string') return undefined;
        return {
            stimulusId: value.stimulusId,
            relation: value.relation,
            targetTurnId: value.relation === DispositionRelation.Same ? value.targetTurnId : undefined,
            urgent: value.urgent ?? false,
            rationale: typeof value.rationale === 'string' ? value.rationale : undefined,
        };
    }

    private withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                onTimeout?.();
                reject(Error('Awareness schedule timeout'));
            }, ms);
            promise.then(resolve, reject);
            promise.then(
                () => clearTimeout(timer),
                () => clearTimeout(timer),
            );
        });
    }

    private selectDisposition(
        stimuli: Stimulus[],
        dispositions: Disposition[],
        active?: { id: string; speakerId: string },
    ): { stimulus: Stimulus; disposition: Disposition } | undefined {
        const byId = new Map(dispositions.map((disposition) => [disposition.stimulusId, disposition]));
        const canPreempt = (stimulus: Stimulus, disposition: Disposition | undefined): boolean => disposition?.urgent === true
            && (active === undefined || disposition.targetTurnId === undefined || disposition.targetTurnId === active.id)
            && (active === undefined || disposition.relation !== DispositionRelation.Same || stimulus.speakerId === active.speakerId);
        const urgent = stimuli.find((stimulus) => canPreempt(stimulus, byId.get(stimulus.id)));
        const eligible = active === undefined
            ? stimuli[0]
            : stimuli.find((stimulus) => !byId.get(stimulus.id)?.urgent || canPreempt(stimulus, byId.get(stimulus.id)));
        const stimulus = urgent ?? eligible ?? stimuli[0];
        if (!stimulus) return undefined;
        const proposed = byId.get(stimulus.id) ?? this.fallbackDisposition(stimulus);
        const disposition = active !== undefined && proposed.urgent && !canPreempt(stimulus, proposed)
            ? { ...proposed, urgent: false }
            : proposed;
        return { stimulus, disposition };
    }

    private fallbackDisposition(stimulus: Stimulus): Disposition {
        // A failed/ambiguous semantic judgment must not silently fuse unrelated
        // goals merely because they came from the same connection.
        return { stimulusId: stimulus.id, relation: DispositionRelation.New, urgent: false };
    }

    private applyIdleDisposition(stimulus: Stimulus, disposition: Disposition): void {
        if (disposition.relation === DispositionRelation.Same) {
            const target = disposition.targetTurnId ? this.context?.turns.find((turn) => turn.id === disposition.targetTurnId) : undefined;
            if (!target || target.speakerId !== stimulus.speakerId) {
                this.dispatchNew(stimulus, { stimulusId: stimulus.id, relation: DispositionRelation.New, urgent: disposition.urgent });
                return;
            }
            if (target.status === 'working' || target.status === 'waiting') return;
            this.dispatchMain(stimulus, disposition);
            return;
        }
        this.dispatchNew(stimulus, disposition);
    }

    private dispatchNew(stimulus: Stimulus, disposition: Disposition): void {
        if (this.context?.hasCapacity && !this.context.hasCapacity()) {
            this.removeStimulus(stimulus.id);
            this.log.warn('awareness.workspace_backpressure', {
                speakerId: stimulus.speakerId,
                stimulusId: stimulus.id,
            });
            this.deliver(stimulus.speakerId, {
                action: 'error',
                data: Awareness.WorkspaceBackpressureMessage,
            });
            this.scheduleSoon();
            return;
        }
        this.dispatchMain(stimulus, disposition);
    }

    private dispatchMain(stimulus: Stimulus, disposition: Disposition): void {
        if (!this.isPending(stimulus)) return;
        this.removeStimulus(stimulus.id);
        this.pendingMain = stimulus;
        const instruction: AttentionInstruction = {
            relation: disposition.relation,
            targetTurnId: disposition.targetTurnId,
            urgent: disposition.urgent ?? false,
        };
        const routed = { ...stimulus, attention: instruction };
        let operation: Promise<void> | void;
        try {
            if (disposition.relation === DispositionRelation.Same && disposition.targetTurnId && this.cortex?.revise) {
                operation = this.cortex.revise(routed, disposition.targetTurnId);
            } else {
                operation = this.cortex?.attend(routed, instruction);
            }
        } catch (error) {
            operation = Promise.reject(error);
        }
        Promise.resolve(operation)
            .catch((error) => this.log.error('awareness.cortex', { name: error instanceof Error ? error.name : 'UnknownError' }))
            .finally(() => {
                if (this.pendingMain?.id === stimulus.id) this.pendingMain = undefined;
                this.releaseForgottenSpeaker(stimulus.speakerId);
                this.scheduleSoon();
            });
    }

    private removeStimulus(id: string): void {
        this.stimuli = this.stimuli.filter((stimulus) => stimulus.id !== id);
    }

    private isPending(stimulus: Stimulus): boolean {
        return !this.forgottenSpeakers.has(stimulus.speakerId)
            && this.stimuli.some((candidate) => candidate.id === stimulus.id);
    }

    private pruneStreamState(): void {
        const activeTurnIds = new Set((this.context?.turns ?? []).map((turn) => turn.id));
        for (const turnId of this.streamState.keys()) {
            if (!activeTurnIds.has(turnId)) {
                this.streamState.delete(turnId);
                this.bufferedChunks.delete(turnId);
            }
        }
    }

    private releaseForgottenSpeaker(speakerId: string): void {
        if (!this.forgottenSpeakers.has(speakerId)) return;
        if (this.pendingMain?.speakerId === speakerId) return;
        if ((this.context?.turns ?? []).some((turn) => turn.speakerId === speakerId)) return;
        if ([...this.streamState.values()].some((state) => state.speakerId === speakerId)) return;
        if (this.mouthQueue.some((mouthful) => mouthful.speakerId === speakerId)) return;
        this.forgottenSpeakers.delete(speakerId);
    }

    private pendingCapacity(): number {
        const configured = this.config?.awareness?.pendingCapacity;
        return typeof configured === 'number' && Number.isFinite(configured)
            ? Math.max(1, Math.floor(configured))
            : Awareness.DefaultPendingCapacity;
    }

    private targets(active: { id: string }, disposition: Disposition): boolean {
        return disposition.targetTurnId === undefined || disposition.targetTurnId === active.id;
    }

    private flushMouthQueue(): void {
        while (this.mouthOwner === undefined && this.mouthQueue.length > 0) {
            const next = this.mouthQueue.shift()!;
            this.deliver(next.speakerId, { action: 'agent', data: next.text });
            this.deliver(next.speakerId, { action: 'streamEnd', data: true });
        }
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
