import type { SocketPacket } from '@/neural/ipc';
import type { ConfigService } from '@/configuration';
import type { Context } from '@/agent/context';
import type { Intelligence } from '@/agent/brain/intelligence';
import { Config, Inject, Prompt, PromptService, Singleton } from '@/core';
import { FService } from '@/core/ioc';
import { parse } from '@/agent/json';
import type { Synapse } from '@/neural/synapse';
import { AgentChatRole } from '@/agent/types';
import { DispositionAction, type Disposition, type Mouthful, type ScheduleVerdict, type Stimulus } from './types';

interface BufferedChunk {
    speakerId: string;
    chunks: string[];
    streamEnd: boolean;
}

/**
 * EN: Awareness is the life-form's thalamus + reticular activating system.
 * It owns every stimulus until it reaches the cortex, decides what is salient,
 * and schedules one conscious thought at a time. Background workers run in
 * parallel, but the mouth is strictly serial.
 * ZH: Awareness 是生命体的丘脑 + 网状激活系统。它持有所有到达皮层之前的刺激、
 * 决定显著性、一次只安排一个意识内容。后台 worker 可并行运行,但嘴严格串行。
 */
@Singleton()
export class Awareness extends FService {
    @Config()
    public config!: ConfigService;

    @Inject()
    public context!: Context;

    @Inject()
    public intelligence!: Intelligence;

    @Prompt('prompts/awareness')
    public prompt!: PromptService;

    private cortex?: Synapse;
    private sequence = 0;
    private stimuli: Stimulus[] = [];
    private pendingMain?: Stimulus;
    private runningWorkers = 0;
    private mouthOwner?: string;
    private mouthQueue: Mouthful[] = [];
    private bufferedChunks = new Map<string, BufferedChunk>();
    private preemptFlags = new Set<string>();
    private batchTimer?: ReturnType<typeof setTimeout>;
    private scheduling = false;

    public attend(cortex: Synapse): void {
        this.cortex = cortex;
    }

    /**
     * EN: One speaker said something. The connection has already provided the
     * speakerId; we only record the stimulus and schedule attention soon.
     * ZH: 一个说话人说了话。连接已经提供 speakerId;我们只记录刺激并稍后调度注意。
     */
    public perceive(input: { speakerId: string; text: string }): Stimulus {
        this.sequence += 1;
        const stimulus: Stimulus = { id: `stim_${this.sequence}`, ...input, ts: Date.now() };
        this.stimuli.push(stimulus);
        this.scheduleSoon();
        return stimulus;
    }

    /**
     * EN: A connection closed. Drop the speaker's pending stimuli and any
     * mouth output waiting for them; the life-form stops talking to someone
     * who has left.
     * ZH: 连接关闭。丢弃该说话人的待处理刺激和等待发给他的嘴输出;
     * 生命体不再对一个已经离开的人说话。
     */
    public forget(speakerId: string): void {
        this.stimuli = this.stimuli.filter((s) => s.speakerId !== speakerId);
        this.mouthQueue = this.mouthQueue.filter((m) => m.speakerId !== speakerId);
        for (const [turnId, buffer] of this.bufferedChunks) {
            if (buffer.speakerId === speakerId) this.bufferedChunks.delete(turnId);
        }
    }

    /**
     * EN: An answer to a pending ask/confirm arrived. These bypass the
     * scheduler entirely because the cortex is already waiting for them.
     * ZH: pending ask/confirm 的回答到达。这些完全绕过调度器,因为皮层正在等它们。
     */
    public answer(turnId: string, id: string, response: unknown): void {
        this.cortex?.answer(turnId, id, response as never);
    }

    public preempted(turnId: string): boolean {
        return this.preemptFlags.has(turnId);
    }

    /**
     * EN: Called by the cortex when a turn has been interrupted and its partial
     * summary is already settled. We clear the flag, release the mouth, and
     * re-schedule the merged re-think.
     * ZH: 皮层通知某 turn 已被打断且部分摘要已结算。我们清除标志、释放嘴、
     * 重新调度合并后的重想。
     */
    public turnInterrupted(turnId: string): void {
        this.preemptFlags.delete(turnId);
        if (this.mouthOwner === turnId) {
            this.mouthOwner = undefined;
            this.flushMouthQueue();
        }
        this.scheduleSoon();
    }

    public turnSettled(turnId: string): void {
        this.scheduleSoon();
    }

    public turnPaused(turnId: string): void {
        this.scheduleSoon();
    }

    /**
     * EN: Mouth arbitration: one turn may stream at a time. Chunks for another
     * turn are buffered until the current speaker finishes. `chunk === null`
     * marks the end of the stream.
     * ZH: 嘴的仲裁：同一时刻只有一个 turn 能流式输出。另一个 turn 的分片先缓冲,
     * 等当前说话人说完。`chunk === null` 表示流结束。
     */
    public speak(turnId: string, speakerId: string, chunk: string | null): void {
        if (this.mouthOwner === undefined || this.mouthOwner === turnId) {
            if (chunk === null) {
                this.deliver(speakerId, { action: 'streamEnd', data: true });
                this.mouthOwner = undefined;
                this.flushBufferedChunks();
                this.flushMouthQueue();
                return;
            }
            this.mouthOwner = turnId;
            this.deliver(speakerId, { action: 'agent', data: chunk });
            return;
        }
        const buffer: BufferedChunk = this.bufferedChunks.get(turnId) ?? { speakerId, chunks: [], streamEnd: false };
        if (chunk === null) {
            buffer.streamEnd = true;
        } else {
            buffer.chunks.push(chunk);
        }
        this.bufferedChunks.set(turnId, buffer);
    }

    private flushBufferedChunks(): void {
        for (const [turnId, buffer] of this.bufferedChunks) {
            for (const chunk of buffer.chunks) {
                this.deliver(buffer.speakerId, { action: 'agent', data: chunk });
            }
            if (buffer.streamEnd) {
                this.deliver(buffer.speakerId, { action: 'streamEnd', data: true });
            }
            this.bufferedChunks.delete(turnId);
        }
    }

    /**
     * EN: A background worker has a complete answer. It waits for the mouth
     * the same way a thought waits to be spoken.
     * ZH: 后台 worker 产出了完整答案。它像等待说出口的想法一样等嘴。
     */
    public say(speakerId: string, text: string): void {
        this.mouthQueue.push({ speakerId, text });
        this.flushMouthQueue();
    }

    private deliver(speakerId: string, packet: SocketPacket): void {
        this.cortex?.deliver(speakerId, packet);
    }

    private scheduleSoon(): void {
        if (this.batchTimer) clearTimeout(this.batchTimer);
        this.batchTimer = setTimeout(() => this.schedule(), this.config.awareness.batchWindowMs);
    }

    private async schedule(): Promise<void> {
        if (this.scheduling) return;
        this.scheduling = true;
        try {
            await this.runSchedule();
        } finally {
            this.scheduling = false;
        }
    }

    private async runSchedule(): Promise<void> {
        if (!this.cortex) return;
        const runnable = this.stimuli.filter((s) => this.canStart(s));
        if (runnable.length === 0) return;

        if (!this.isBusy() && runnable.length === 1) {
            this.dispatchMain(runnable[0]!);
            return;
        }

        const verdict = await this.scheduleWithModel(runnable);
        if (verdict === undefined) {
            this.applyFallback(runnable);
            return;
        }
        this.applyVerdict(verdict);
    }

    private canStart(stimulus: Stimulus): boolean {
        if (this.pendingMain?.id === stimulus.id) return false;
        return true;
    }

    private isBusy(): boolean {
        const active = this.context.working();
        if (active) return true;
        if (this.pendingMain === undefined) return false;
        return this.context.turnForStimulus(this.pendingMain.id) === undefined;
    }

    private applyFallback(runnable: Stimulus[]): void {
        if (this.isBusy()) return;
        for (const stimulus of runnable) {
            if (this.isBusy()) break;
            this.dispatchMain(stimulus);
        }
    }

    private async scheduleWithModel(runnable: Stimulus[]): Promise<Disposition[] | undefined> {
        const working = this.context.turns.filter((t) => t.status === 'working');
        const payload = {
            working: working.map((t) => ({
                turnId: t.id,
                speakerId: t.speakerId,
                intent: t.intent,
                goal: t.goal,
                paused: t.pause?.kind ?? null,
                assistant: t.assistant,
                evidence: t.summary?.evidence ?? [],
            })),
            stimuli: runnable.map((s) => ({ id: s.id, speakerId: s.speakerId, text: s.text, waitMs: Date.now() - s.ts })),
        };
        try {
            const raw = await this.withTimeout(
                this.intelligence.completeText([
                    { role: AgentChatRole.System, content: this.prompt.section('SCHEDULE') },
                    { role: AgentChatRole.User, content: JSON.stringify(payload) },
                ]),
                this.config.awareness.scheduleTimeoutMs,
            );
            return parse<ScheduleVerdict>(raw).dispositions;
        } catch (error) {
            this.log.warn('awareness.schedule.timeout', error);
            return undefined;
        }
    }

    private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        return Promise.race([
            promise,
            new Promise<never>((_, reject) => setTimeout(() => reject(Error('Awareness schedule timeout')), ms)),
        ]);
    }

    private applyVerdict(dispositions: Disposition[]): void {
        const byStimulus = new Map(dispositions.map((d) => [d.stimulusId, d]));
        const ordered = [...this.stimuli]
            .filter((s) => byStimulus.has(s.id))
            .sort((a, b) => (byStimulus.get(b.id)?.priority ?? 0) - (byStimulus.get(a.id)?.priority ?? 0));
        for (const stimulus of ordered) {
            this.applyDisposition(stimulus, byStimulus.get(stimulus.id)!);
        }
    }

    private applyDisposition(stimulus: Stimulus, disposition: Disposition): void {
        if (disposition.action === DispositionAction.Preempt) {
            if (disposition.targetTurnId) this.preemptFlags.add(disposition.targetTurnId);
            return;
        }
        if (disposition.action === DispositionAction.Concurrent) {
            if (this.canRunConcurrent()) this.dispatchWorker(stimulus);
            return;
        }
        if (this.isBusy()) return;
        if (disposition.action === DispositionAction.Merge || disposition.action === DispositionAction.Queue || disposition.action === DispositionAction.AnswerFirst) {
            if (disposition.queueAfter && this.context.turns.some((t) => t.id === disposition.queueAfter && t.status === 'working')) return;
            this.dispatchMain(stimulus);
        }
    }

    private dispatchMain(stimulus: Stimulus): void {
        this.removeStimulus(stimulus.id);
        this.pendingMain = stimulus;
        const promise = this.cortex?.attend(stimulus);
        if (promise) {
            promise.finally(() => {
                if (this.pendingMain?.id === stimulus.id) this.pendingMain = undefined;
                this.scheduleSoon();
            });
        } else {
            this.pendingMain = undefined;
            this.scheduleSoon();
        }
    }

    private dispatchWorker(stimulus: Stimulus): void {
        this.removeStimulus(stimulus.id);
        this.runningWorkers += 1;
        const promise = this.cortex?.ponder(stimulus);
        if (promise) {
            promise.finally(() => {
                this.runningWorkers -= 1;
                this.scheduleSoon();
            });
        } else {
            this.runningWorkers -= 1;
            this.scheduleSoon();
        }
    }

    private removeStimulus(id: string): void {
        this.stimuli = this.stimuli.filter((s) => s.id !== id);
    }

    private canRunConcurrent(): boolean {
        return this.runningWorkers < this.config.awareness.maxConcurrentThoughts;
    }

    private flushMouthQueue(): void {
        while (this.mouthOwner === undefined && this.mouthQueue.length > 0) {
            const next = this.mouthQueue.shift()!;
            this.deliver(next.speakerId, { action: 'agent', data: next.text });
            this.deliver(next.speakerId, { action: 'streamEnd', data: true });
        }
    }
}
