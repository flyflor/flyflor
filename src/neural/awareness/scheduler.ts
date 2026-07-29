import type { ConfigService } from '@/configuration';
import { Workspace } from '@/neural/workspace';
import { Intelligence } from '@/neural/brain/intelligence/service';
import { Config, FComponent, Inject, Prompt, PromptService, Singleton } from '@/core';
import { parse } from '@/neural/json';
import { ChatRole } from '@/neural/brain/types';
import { DispositionRelation, type AttentionInstruction, type Disposition, type Stimulus } from './types';

/**
 * EN: The boundary services a Scheduler needs from its host (Awareness).
 * The scheduler owns queue mechanics; the host owns the cortex boundary,
 * the mouth, and speaker tombstones.
 * ZH: Scheduler 需要宿主(Awareness)提供的边界服务。调度器持有队列机制;
 * 宿主持有皮层边界、嘴巴与说话人墓碑。
 */
export interface SchedulerHost {
    /** EN: Routes one dispatched stimulus into the cortex (attend or revise). ZH: 把一条被派发的刺激路由进皮层(attend 或 revise)。 */
    route(stimulus: Stimulus, instruction: AttentionInstruction): Promise<void> | void;
    /** EN: Cancels provider work for a foreground Turn marked urgent. ZH: 取消被标记紧急的前台 Turn 的提供方工作。 */
    cancel(turnId: string): void;
    /** EN: Delivers a scheduling error notice back to one speaker. ZH: 向某个说话人回送一条调度错误提示。 */
    deliverError(speakerId: string, message: string): void;
    /** EN: Whether the speaker has been tombstoned after disconnecting. ZH: 该说话人是否已在断连后被立碑。 */
    forgotten(speakerId: string): boolean;
    /** EN: Notifies the host that one dispatched stimulus has fully settled. ZH: 通知宿主一条被派发的刺激已完全收尾。 */
    dispatchSettled(speakerId: string): void;
}

/**
 * EN: Scheduler is the life-form's central executive: a bounded, deterministic
 * scheduling policy over pending stimuli. The LLM verdict is only a semantic
 * advisor for relatedness (same/new) and urgency; admission, ordering,
 * fairness, and pre-emption mechanics are deterministic and testable.
 * ZH: Scheduler 是生命体的中央执行器:对待处理刺激的确定性有界调度策略。
 * LLM 判决只是关联性(same/new)与紧急程度的语义顾问;准入、排序、公平性与
 * 抢占机制都是确定性、可测试的。
 *
 * EN: Ordering policy: a validated urgent stimulus may pre-empt the
 * foreground; otherwise dispatches round-robin across speakers with per-speaker
 * FIFO preserved, so one talkative speaker cannot starve the others.
 * ZH: 排序策略:校验通过的紧急刺激可以抢占前台;其余按跨说话人轮转派发,
 * 说话人内部保持 FIFO,健谈的说话人不会让其他人饥饿。
 */
@Singleton()
export class Scheduler extends FComponent {
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
    public workspace!: Workspace;

    /** EN: Intelligence provider used for scheduling verdicts. ZH: 用于生成调度判决的智能提供方。 */
    @Inject()
    public intelligence!: Intelligence;

    /** EN: Prompt template for the scheduling-advisor LLM. ZH: 调度顾问 LLM 的提示词模板。 */
    @Prompt('prompts/awareness')
    public prompt!: PromptService;

    /** EN: The stimulus whose dispatch is currently in flight. ZH: 当前正在派发途中的刺激。 */
    public pending?: Stimulus;

    /** EN: Boundary services wired by the host at attend time. ZH: attend 时由宿主接线的边界服务。 */
    private host?: SchedulerHost;
    /** EN: FIFO queue of stimuli awaiting a scheduling verdict. ZH: 等待调度判决的刺激 FIFO 队列。 */
    private stimuli: Stimulus[];
    /** EN: Turn ids marked urgent and awaiting cancellation. ZH: 被标记紧急、等待取消的 Turn id。 */
    private preemptFlags: Set<string>;
    /** EN: Speaker served by the most recent dispatch; drives round-robin fairness. ZH: 最近一次派发服务的说话人;驱动轮转公平。 */
    private lastSpeaker?: string;
    /** EN: Coalescing timer for the next scheduling pass. ZH: 下一轮调度的合批定时器。 */
    private batchTimer?: ReturnType<typeof setTimeout>;
    /** EN: Reentrancy guard for the async scheduler. ZH: 异步调度器的重入守卫。 */
    private scheduling: boolean;
    /** EN: Requests one more scheduling pass after the current run. ZH: 请求本轮调度结束后再跑一轮。 */
    private scheduleAgain: boolean;

    constructor() {
        super();
        // EN: No host until Awareness attaches its boundary services. ZH: Awareness 接线边界服务前没有宿主。
        this.host = undefined;
        // EN: FIFO queue of stimuli awaiting a verdict. ZH: 等待判决的刺激 FIFO 队列。
        this.stimuli = [];
        // EN: Turn ids marked urgent and awaiting cancellation. ZH: 被标记紧急、等待取消的 Turn id。
        this.preemptFlags = new Set();
        // EN: No speaker served yet; the first dispatch is plain FIFO. ZH: 尚未服务任何说话人;首次派发是纯 FIFO。
        this.lastSpeaker = undefined;
        // EN: Reentrancy guard for the async scheduler. ZH: 异步调度器的重入守卫。
        this.scheduling = false;
        // EN: Requests one more scheduling pass after the current run. ZH: 请求本轮调度结束后再跑一轮。
        this.scheduleAgain = false;
    }

    /**
     * EN: Attaches the host boundary services. Scheduling stays inert until a
     * host exists, mirroring the old `if (!this.cortex) return` guard.
     * ZH: 接线宿主边界服务。宿主存在前调度保持惰性,对应旧的
     * `if (!this.cortex) return` 守卫。
     */
    public attach(host: SchedulerHost): void {
        this.host = host;
    }

    /**
     * EN: Admits one perceived stimulus into the pending queue. Returns false
     * when the queue is at capacity; the caller owns the backpressure notice.
     * ZH: 把一条已感知的刺激准入待处理队列。队列满时返回 false;
     * 背压提示由调用方负责。
     */
    public enqueue(stimulus: Stimulus): boolean {
        if (this.stimuli.length >= this.pendingCapacity()) {
            this.log.warn('scheduler.backpressure', {
                speakerId: stimulus.speakerId,
                stimulusId: stimulus.id,
                pending: this.stimuli.length,
                capacity: this.pendingCapacity(),
            });
            return false;
        }
        this.stimuli.push(stimulus);
        this.kick();
        return true;
    }

    /**
     * EN: Drops every pending stimulus owned by one speaker.
     * ZH: 丢弃某个说话人拥有的全部待处理刺激。
     */
    public dropSpeaker(speakerId: string): void {
        this.stimuli = this.stimuli.filter((stimulus) => stimulus.speakerId !== speakerId);
    }

    /**
     * EN: Requests a scheduling pass within the fixed coalescing window.
     * Resetting the timer for every arrival would let a sustained stimulus
     * stream postpone attention forever.
     * ZH: 在固定合批窗口内请求一次调度。若每条到达都重置定时器,持续的
     * 刺激流会让注意力永远推迟。
     */
    public kick(): void {
        if (this.batchTimer !== undefined) return;
        const delay = this.config?.awareness?.batchWindowMs ?? 0;
        this.batchTimer = setTimeout(() => {
            this.batchTimer = undefined;
            void this.schedule();
        }, delay);
    }

    /**
     * EN: A Turn settled: a stale urgent flag is discarded when completion won
     * the race, then the next scheduling pass is requested.
     * ZH: 某个 Turn 已收尾:若正常完成赢过了紧急请求,丢弃过期紧急标记,
     * 然后请求下一轮调度。
     */
    public settled(turnId: string): void {
        const turn = this.workspace?.turns.find((candidate) => candidate.id === turnId || candidate.stimulusId === turnId);
        if (!turn || turn.status === 'completed' || turn.status === 'suspended') this.preemptFlags.delete(turn?.id ?? turnId);
        this.kick();
    }

    /**
     * EN: A Turn was compacted after interruption: clear its urgent flag, drop
     * any in-flight dispatch that grew into it, and request the next pass.
     * ZH: 某个 Turn 被打断后已压缩:清除其紧急标记,丢弃长成它的在途派发,
     * 并请求下一轮调度。
     */
    public interrupted(turnId: string): void {
        this.preemptFlags.delete(turnId);
        if (this.pending && this.workspace?.turnForStimulus(this.pending.id)?.id === turnId) {
            this.pending = undefined;
        }
        this.kick();
    }

    /**
     * EN: A Turn paused at an interaction boundary; the dispatch promise
     * remains the foreground lock, so this only lets a pending urgent verdict
     * be considered after the interaction resumes.
     * ZH: 某个 Turn 在交互边界暂停;派发 promise 仍是前台锁,因此这里只是
     * 让待处理的紧急判决在交互恢复后可被考虑。
     */
    public paused(): void {
        this.kick();
    }

    /** EN: Whether the Turn has been marked urgent and is awaiting cancellation. ZH: 该 Turn 是否已被标记紧急、正等待取消。 */
    public preempted(turnId: string): boolean {
        return this.preemptFlags.has(turnId);
    }

    /** EN: Marks a Turn urgent so its provider work is cancelled. ZH: 把某个 Turn 标记为紧急,以便取消其提供方工作。 */
    public markPreempted(turnId: string): void {
        this.preemptFlags.add(turnId);
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
                this.kick();
            }
        }
    }

    private async runSchedule(): Promise<void> {
        if (!this.host || this.pending || this.stimuli.length === 0) return;
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
                this.host.cancel(active.id);
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
        const turns = this.workspace?.turns ?? [];
        return turns.findLast((turn) => turn.status === 'working' || turn.status === 'waiting');
    }

    private async scheduleWithModel(runnable: Stimulus[]): Promise<Disposition[]> {
        const turns = this.workspace?.turns ?? [];
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
                outcome: turn.outcome ?? null,
            })),
            situation: this.workspace?.situationProjection() ?? [],
            stimuli: runnable.map((stimulus) => ({ id: stimulus.id, speakerId: stimulus.speakerId, text: stimulus.text })),
        };
        try {
            const controller = new AbortController();
            const raw = await this.withTimeout(
                this.intelligence.completeText([
                    { role: ChatRole.System, content: this.prompt.section('SCHEDULE') },
                    { role: ChatRole.User, content: JSON.stringify(payload) },
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
            this.log.warn('scheduler.schedule.timeout', { name: error instanceof Error ? error.name : 'UnknownError' });
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
                reject(Error('Scheduler schedule timeout'));
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
        // Round-robin across speakers: skip the speaker served most recently so
        // a talkative speaker cannot starve the others; per-speaker FIFO is
        // preserved because each speaker's oldest pending stimulus leads.
        const eligible = active === undefined
            ? (stimuli.find((stimulus) => stimulus.speakerId !== this.lastSpeaker) ?? stimuli[0])
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
            const target = disposition.targetTurnId ? this.workspace?.turns.find((turn) => turn.id === disposition.targetTurnId) : undefined;
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
        if (this.workspace?.hasCapacity && !this.workspace.hasCapacity()) {
            this.removeStimulus(stimulus.id);
            this.log.warn('scheduler.workspace_backpressure', {
                speakerId: stimulus.speakerId,
                stimulusId: stimulus.id,
            });
            this.host?.deliverError(stimulus.speakerId, Scheduler.WorkspaceBackpressureMessage);
            this.kick();
            return;
        }
        this.dispatchMain(stimulus, disposition);
    }

    private dispatchMain(stimulus: Stimulus, disposition: Disposition): void {
        if (!this.host || !this.isPending(stimulus)) return;
        this.removeStimulus(stimulus.id);
        this.pending = stimulus;
        this.lastSpeaker = stimulus.speakerId;
        const instruction: AttentionInstruction = {
            relation: disposition.relation,
            targetTurnId: disposition.targetTurnId,
            urgent: disposition.urgent ?? false,
        };
        const routed = { ...stimulus, attention: instruction };
        let operation: Promise<void> | void;
        try {
            operation = this.host.route(routed, instruction);
        } catch (error) {
            operation = Promise.reject(error);
        }
        Promise.resolve(operation)
            .catch((error) => this.log.error('scheduler.cortex', { name: error instanceof Error ? error.name : 'UnknownError' }))
            .finally(() => {
                if (this.pending?.id === stimulus.id) this.pending = undefined;
                this.host?.dispatchSettled(stimulus.speakerId);
                this.kick();
            });
    }

    private removeStimulus(id: string): void {
        this.stimuli = this.stimuli.filter((stimulus) => stimulus.id !== id);
    }

    private isPending(stimulus: Stimulus): boolean {
        return !(this.host?.forgotten(stimulus.speakerId) ?? false)
            && this.stimuli.some((candidate) => candidate.id === stimulus.id);
    }

    private targets(active: { id: string }, disposition: Disposition): boolean {
        return disposition.targetTurnId === undefined || disposition.targetTurnId === active.id;
    }

    private pendingCapacity(): number {
        const configured = this.config?.awareness?.pendingCapacity;
        return typeof configured === 'number' && Number.isFinite(configured)
            ? Math.max(1, Math.floor(configured))
            : Scheduler.DefaultPendingCapacity;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
