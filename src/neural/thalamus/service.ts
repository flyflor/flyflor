import type { SocketPacket } from '@/neural/sensorimotor';
import type { ConfigService } from '@/configuration';
import { Workspace } from '@/neural/workspace';
import { Config, Provide } from '@/core';
import { FService } from '@/core/ioc';
import type { Cortex } from '@/neural/cortex';
import type { InteractionResponse } from '@/neural/types';
import { Scheduler } from './scheduler';
import { DispositionRelation, type AttentionInstruction, type Stimulus } from './types';

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
 * EN: The small protocol Thalamus needs from the cortex.  `revise` and `cancel`
 * are optional while Cortex is being migrated; the attention instruction is
 * also attached to the routed stimulus so an older cortex can safely ignore
 * the extra argument and a newer one can route it to Workspace.revise().
 * ZH: Thalamus 需要皮层提供的最小协议。在 Cortex 迁移期间 `revise` 与 `cancel`
 * 为可选；注意指令也会附加在路由出去的刺激上，旧皮层可以安全忽略这个额外参数，
 * 新皮层则可以将其路由到 Workspace.revise()。
 */
interface ThalamusCortex {
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
 * EN: Thalamus is the life-form's attention gate — the thalamic surface. It
 * perceives stimuli, arbitrates the single mouth, and owns speaker
 * tombstones. Queue mechanics, ordering, fairness, and pre-emption policy
 * belong to the injected `Scheduler` (the central executive); Thalamus never
 * re-implements them. There are no cross-stimulus background workers.
 * ZH: Thalamus 是生命体的注意门——丘脑表面。它感知刺激、仲裁唯一的嘴巴、
 * 持有说话人墓碑。队列机制、排序、公平性与抢占策略归属注入的 `Scheduler`
 * (中央执行器);Thalamus 绝不重复实现它们。不存在跨刺激的后台 worker。
 */
@Provide()
export class Thalamus extends FService {
    /** EN: Backpressure notice sent when the attention queue is full. ZH: 注意队列满时发送的背压提示。 */
    public static readonly QueueBackpressureMessage = Scheduler.QueueBackpressureMessage;
    /** EN: Backpressure notice sent when the semantic workspace is full. ZH: 语义工作区满时发送的背压提示。 */
    public static readonly WorkspaceBackpressureMessage = Scheduler.WorkspaceBackpressureMessage;

    /** EN: Runtime configuration injected from the IOC container. ZH: 由 IOC 容器注入的运行时配置。 */
    @Config()
    public config!: ConfigService;

    private cortex?: ThalamusCortex;
    private sequence: number;
    private mouthOwner?: string;
    private mouthQueue: Mouthful[];
    private bufferedChunks: Map<string, BufferedChunk>;
    private streamState: Map<string, { speakerId: string; streamId?: string; ended: boolean }>;
    private forgottenSpeakers: Set<string>;

    constructor(
        /** EN: Semantic workspace consulted for Turn state and capacity. ZH: 用于查询 Turn 状态与容量的语义工作区。 */
        public workspace: Workspace,
        /** EN: Central executive that owns stimulus queueing, ordering, and pre-emption policy. ZH: 持有刺激队列、排序与抢占策略的中央执行器。 */
        public scheduler: Scheduler,
    ) {
        super();
        // EN: Monotonic id source for perceived stimuli. ZH: 感知刺激的单调 id 来源。
        this.sequence = 0;
        // EN: Full texts waiting for the single mouth to free up. ZH: 等待单口空闲的完整文本队列。
        this.mouthQueue = [];
        // EN: Chunks held while another Turn owns the mouth. ZH: 其他 Turn 占用单口时暂存的分片。
        this.bufferedChunks = new Map();
        // EN: Per-Turn stream generation and ended state. ZH: 每个 Turn 的流代次与结束状态。
        this.streamState = new Map();
        // EN: Tombstoned speakers whose work is still settling. ZH: 已离开但工作仍在收尾的说话人墓碑。
        this.forgottenSpeakers = new Set();
    }

    /**
     * EN: Attaches the cortex so Thalamus can route attended stimuli, cancels,
     * answers, and motor output through it; also wires the scheduler's host
     * boundary onto the same cortex.
     * ZH: 挂载皮层，使 Thalamus 经它路由已注意的刺激、取消、答复和运动输出；
     * 同时把调度器的宿主边界接到同一个皮层上。
     */
    public attend(cortex: Cortex): void {
        this.cortex = cortex as unknown as ThalamusCortex;
        const bound = this.cortex;
        this.scheduler.attach({
            route: (stimulus, instruction) => {
                if (instruction.relation === DispositionRelation.Same && instruction.targetTurnId && bound.revise) {
                    return bound.revise(stimulus, instruction.targetTurnId);
                }
                return bound.attend(stimulus, instruction);
            },
            cancel: (turnId) => {
                void bound.cancel?.(turnId);
            },
            deliverError: (speakerId, message) => this.deliver(speakerId, { action: 'error', data: message }),
            forgotten: (speakerId) => this.forgottenSpeakers.has(speakerId),
            dispatchSettled: (speakerId) => this.releaseForgottenSpeaker(speakerId),
        });
    }

    /**
     * EN: Records one external stimulus. Admission and ordering are owned by
     * the scheduler; when the pending queue is full a backpressure packet is
     * delivered and undefined is returned.
     * ZH: 记录一条外部刺激。准入与排序由调度器持有;待处理队列满时回送
     * 背压包并返回 undefined。
     */
    public perceive(input: { speakerId: string; text: string }): Stimulus | undefined {
        this.forgottenSpeakers.delete(input.speakerId);
        this.sequence += 1;
        const stimulus: Stimulus = { id: `stim_${this.sequence}`, ...input, ts: Date.now() };
        if (!this.scheduler.enqueue(stimulus)) {
            this.deliver(input.speakerId, {
                action: 'error',
                data: Scheduler.QueueBackpressureMessage,
            });
            return undefined;
        }
        return stimulus;
    }

    /**
     * EN: Drops all pending/output state belonging to a disconnected speaker. An
     * active working turn is retained until its cancellation callback settles,
     * so Workspace does not race the cortex's interrupt/settle path; inactive
     * turns are removed immediately.
     * ZH: 丢弃某个已断开说话人的全部待处理/输出状态。活跃的进行中 Turn 会保留到
     * 其取消回调收尾，避免 Workspace 与皮层的打断/收尾路径竞争；非活跃 Turn 立即移除。
     */
    public forget(speakerId: string): void {
        this.forgottenSpeakers.add(speakerId);
        this.scheduler.dropSpeaker(speakerId);
        this.mouthQueue = this.mouthQueue.filter((mouthful) => mouthful.speakerId !== speakerId);
        const ownedMouth = this.mouthOwner
            && (this.streamState.get(this.mouthOwner)?.speakerId === speakerId
                || this.workspace?.turns.find((turn) => turn.id === this.mouthOwner)?.speakerId === speakerId)
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
            this.scheduler.markPreempted(active.id);
            void this.cortex?.cancel?.(active.id);
            void this.cortex?.forgetSpeaker?.(speakerId);
        } else {
            // A waiting Turn may already own the mouth even though it no longer
            // counts as working. Release that lock before deleting its Workspace
            // state, or every later speaker would remain buffered forever.
            if (ownedMouth !== undefined) {
                this.terminateInterruptedStream(ownedMouth);
                this.bufferedChunks.delete(ownedMouth);
                this.mouthOwner = undefined;
                this.flushBufferedChunks();
                this.flushMouthQueue();
            }
            // Let the cortex reject any interaction waiter before removing its
            // Workspace turn; otherwise a disconnected waiting turn can leave a
            // promise unresolved forever.
            void this.cortex?.forgetSpeaker?.(speakerId);
            this.workspace?.forgetSpeaker(speakerId);
        }
        this.pruneStreamState();
        this.releaseForgottenSpeaker(speakerId);
        this.scheduler.kick();
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
            const turn = this.workspace?.turns.find((candidate) => candidate.id === turnId);
            if (!turn || turn.speakerId !== speakerId) throw Error(`Answer does not belong to speaker: ${turnId}`);
        }
        this.cortex?.answer(turnId, id, response as InteractionResponse, speakerId);
    }

    /** EN: Whether the Turn has been marked urgent and is awaiting cancellation. ZH: 该 Turn 是否已被标记紧急、正等待取消。 */
    public preempted(turnId: string): boolean {
        return this.scheduler.preempted(turnId);
    }

    /**
     * EN: Called by the cortex after it has compacted an interrupted Turn. A
     * stream cannot be retracted, so an interruption is explicitly terminated
     * on the wire before the next foreground stream is released.
     * ZH: 皮层压缩完被打断的 Turn 后调用。流无法撤回，因此在释放下一条前台流之前，
     * 必须先在线上显式终止被打断的流。
     */
    public turnInterrupted(turnId: string): void {
        this.scheduler.interrupted(turnId);
        const interrupted = this.workspace?.turns.find((turn) => turn.id === turnId);
        this.terminateInterruptedStream(turnId);
        this.bufferedChunks.delete(turnId);
        if (this.mouthOwner === turnId) this.mouthOwner = undefined;
        this.flushBufferedChunks();
        this.flushMouthQueue();
        if (interrupted && this.forgottenSpeakers.has(interrupted.speakerId)) {
            this.workspace?.forgetSpeaker(interrupted.speakerId);
        }
        this.pruneStreamState();
        if (interrupted) this.releaseForgottenSpeaker(interrupted.speakerId);
    }

    /**
     * EN: Notifies the gate that a Turn settled; the scheduler discards stale
     * urgent flags, forgotten-speaker tombstones are released, and the next
     * pass is scheduled.
     * ZH: 通知注意门某个 Turn 已收尾;调度器丢弃过期的紧急标记、释放已离开
     * 说话人的墓碑,并调度下一轮。
     */
    public turnSettled(turnId: string): void {
        this.scheduler.settled(turnId);
        const turn = this.workspace?.turns.find((candidate) => candidate.id === turnId || candidate.stimulusId === turnId);
        if (turn && this.forgottenSpeakers.has(turn.speakerId)) this.workspace?.forgetSpeaker(turn.speakerId);
        this.pruneStreamState();
        if (turn) this.releaseForgottenSpeaker(turn.speakerId);
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
        this.scheduler.paused();
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
        const owner = this.workspace?.turns.find((turn) => turn.id === turnId);
        if (owner && owner.speakerId !== speakerId) {
            this.log.warn('thalamus.speaker_mismatch', { turnId, speakerId });
            return;
        }
        const previous = this.streamState.get(turnId);
        if (previous?.speakerId !== undefined && previous.speakerId !== speakerId) {
            this.log.warn('thalamus.stream_speaker_mismatch', { turnId, speakerId });
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

    private foregroundTurn() {
        const turns = this.workspace?.turns ?? [];
        return turns.findLast((turn) => turn.status === 'working' || turn.status === 'waiting');
    }

    private terminateInterruptedStream(turnId: string): void {
        const state = this.streamState.get(turnId);
        if (state?.ended) return;
        const speakerId = state?.speakerId
            ?? this.workspace?.turns.find((turn) => turn.id === turnId)?.speakerId
            ?? (this.scheduler.pending?.id === turnId ? this.scheduler.pending.speakerId : undefined);
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

    private pruneStreamState(): void {
        const activeTurnIds = new Set((this.workspace?.turns ?? []).map((turn) => turn.id));
        for (const turnId of this.streamState.keys()) {
            if (!activeTurnIds.has(turnId)) {
                this.streamState.delete(turnId);
                this.bufferedChunks.delete(turnId);
            }
        }
    }

    private releaseForgottenSpeaker(speakerId: string): void {
        if (!this.forgottenSpeakers.has(speakerId)) return;
        if (this.scheduler.pending?.speakerId === speakerId) return;
        if ((this.workspace?.turns ?? []).some((turn) => turn.speakerId === speakerId)) return;
        if ([...this.streamState.values()].some((state) => state.speakerId === speakerId)) return;
        if (this.mouthQueue.some((mouthful) => mouthful.speakerId === speakerId)) return;
        this.forgottenSpeakers.delete(speakerId);
    }

    private flushMouthQueue(): void {
        while (this.mouthOwner === undefined && this.mouthQueue.length > 0) {
            const next = this.mouthQueue.shift()!;
            this.deliver(next.speakerId, { action: 'agent', data: next.text });
            this.deliver(next.speakerId, { action: 'streamEnd', data: true });
        }
    }
}
