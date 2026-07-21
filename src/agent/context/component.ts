import { AgentChatRole } from '@/agent/types';
import { FComponent, Inject, Prompt, PromptService, Singleton } from '@/core';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { parse } from '@/agent/json';
import type { AgentBrief, Ingest, Pause, Settle, Summary, Turn, TurnBrief, TurnDraft } from './types';

@Singleton()
/**
 * EN: Context owns the life-form's bounded semantic working set.
 * ZH: Context 持有生命体有界的语义工作集。
 *
 * EN: A Turn is understood content, not a transcript or an archive.
 * ZH: Turn 是理解后的内容，不是 transcript，也不是历史账本。
 */
export class Context extends FComponent {
    public static readonly Capacity = 4;
    /** Bound the emergency compaction path so a cancelled thought cannot hold the gate forever. */
    public static readonly InterruptTimeoutMs = 3000;

    private sequence = 0;

    @Inject()
    public intelligence!: Intelligence;

    public turns: Turn[] = [];

    @Prompt('prompts/context')
    public prompt!: PromptService;

    public load(current: TurnDraft, meta: Pick<Ingest, 'speakerId' | 'stimulusId'> = { speakerId: 'unknown' }): Turn {
        return this.begin(current, meta);
    }

    public recent(limit = 4): Turn[] {
        return structuredClone(this.turns.slice(-limit));
    }

    public hasCapacity(): boolean {
        return this.turns.length < Context.Capacity || this.turns.some((turn) => turn.status === 'completed');
    }

    public turn(id: string): Turn {
        const turn = this.turns.find((candidate) => candidate.id === id);
        if (!turn) throw Error(`Turn not found: ${id}`);
        return turn;
    }

    /**
     * EN: The one Turn currently occupying the foreground workspace.
     * ZH: 当前占据前台工作空间的唯一 Turn。
     */
    public working(): Turn | undefined {
        return this.turns.findLast((turn) => turn.status === 'working' && !turn.pause);
    }

    /** The single foreground slot, including a Turn waiting on an interaction. */
    public foreground(): Turn | undefined {
        return this.turns.findLast((turn) => turn.status === 'working' || turn.status === 'waiting');
    }

    /**
     * EN: Finds the turn that grew out of one stimulus, if it has begun.
     * ZH: 查找由某条刺激长出的 turn(如果已经开始)。
     */
    public turnForStimulus(stimulusId: string): Turn | undefined {
        return this.turns.find((turn) => turn.stimulusId === stimulusId);
    }

    /**
     * EN: Produces a scoped briefing for one agent. It contains semantic Turn
     * projections from the bounded workspace, never the raw conversation.
     * ZH: 为一个 agent 生成范围简报。只包含有界工作集的语义 Turn 投影，不含原始对话。
     */
    public brief(turnId?: string): AgentBrief {
        const current = turnId === 'none' ? undefined : turnId ? this.turn(turnId) : this.foreground();
        if (!current) {
            return {
                turnId: 'none',
                intent: 'research',
                goal: '',
                constraints: [],
                refs: [],
                done: [],
                open: [],
                workspace: this.turns.map((turn) => this.briefTurn(turn)),
            };
        }
        return {
            turnId: current.id,
            intent: current.intent,
            goal: current.goal,
            constraints: [...current.constraints],
            refs: current.refs.map((ref) => ({ ...ref })),
            cwd: current.cwd,
            done: [...current.done],
            open: [...current.open],
            workspace: this.turns.map((turn) => this.briefTurn(turn)),
        };
    }

    private briefTurn(turn: Turn): TurnBrief {
        return {
            turnId: turn.id,
            intent: turn.intent,
            goal: turn.goal,
            constraints: [...turn.constraints],
            refs: turn.refs.map((ref) => ({ ...ref })),
            cwd: turn.cwd,
            done: [...turn.done],
            open: [...turn.open],
            outcome: turn.summary ? structuredClone(turn.summary) : undefined,
        };
    }

    public async ingest(input: Ingest, signal?: AbortSignal): Promise<Turn> {
        const active = this.foreground();
        if (active) throw Error(`Another turn is already occupying the foreground: ${active.id}`);
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('INGEST') },
            { role: AgentChatRole.User, content: JSON.stringify({ latest: input.text, current: active ? this.briefTurn(active) : null, workspace: this.brief().workspace }) },
        ], signal);
        signal?.throwIfAborted();
        const draft = this.draft(parse<unknown>(raw));
        return this.begin(draft, input);
    }

    public async revise(turnId: string, input: Ingest, signal?: AbortSignal): Promise<Turn> {
        const target = this.turn(turnId);
        if (target.speakerId !== input.speakerId) throw Error(`Turn belongs to another speaker: ${turnId}`);
        if (target.status === 'waiting') throw Error(`Turn is waiting for an interaction: ${turnId}`);
        const active = this.foreground();
        if (active && active.id !== turnId) throw Error(`Another turn is already occupying the foreground: ${active.id}`);
        const expectedStatus = target.status;
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('INGEST') },
            { role: AgentChatRole.User, content: JSON.stringify({ latest: input.text, current: this.briefTurn(target), workspace: this.brief().workspace }) },
        ], signal);
        signal?.throwIfAborted();
        const draft = this.draft(parse<unknown>(raw));
        const current = this.turn(turnId);
        const foreground = this.foreground();
        if (current !== target || current.status !== expectedStatus || (foreground && foreground.id !== turnId)) {
            throw Error(`Turn changed while revising: ${turnId}`);
        }
        Object.assign(target, draft, { status: 'working', stimulusId: input.stimulusId, updated: Date.now() });
        delete target.summary;
        delete target.pause;
        this.touch(target);
        return target;
    }

    public pause(turnId: string, input: Pause): void {
        const turn = this.turn(turnId);
        if (turn.status !== 'working') throw Error(`Turn is not working: ${turnId}`);
        turn.pause = input;
        turn.status = 'waiting';
        turn.updated = Date.now();
    }

    public resume(turnId: string, pauseId?: string): void {
        const turn = this.turn(turnId);
        if (turn.status !== 'waiting' && turn.status !== 'suspended') throw Error(`Turn is not resumable: ${turnId}`);
        const active = this.foreground();
        if (active && active.id !== turnId) throw Error(`Another turn is already occupying the foreground: ${active.id}`);
        if (turn.status === 'waiting' && (pauseId === undefined || turn.pause?.id !== pauseId)) {
            throw Error(`Pause does not match turn: ${turnId}`);
        }
        if (turn.status === 'suspended' && pauseId !== undefined && turn.pause?.id !== pauseId) {
            throw Error(`Pause does not match turn: ${turnId}`);
        }
        delete turn.pause;
        turn.status = 'working';
        turn.updated = Date.now();
    }

    public suspend(turnId: string): void {
        const turn = this.turn(turnId);
        if (turn.status !== 'working') throw Error(`Turn is not working: ${turnId}`);
        turn.status = 'suspended';
        turn.updated = Date.now();
    }

    public async settle(turnId: string, input: Settle, signal?: AbortSignal): Promise<Summary> {
        const turn = this.turn(turnId);
        if (turn.status !== 'working') throw Error(`Turn is not working: ${turnId}`);
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('SETTLE') },
            {
                role: AgentChatRole.User,
                content: JSON.stringify({ ...input, current: this.briefTurn(turn), workspace: this.brief().workspace }),
            },
        ], signal);
        signal?.throwIfAborted();
        const summary = { ...this.compactSummary(parse<unknown>(raw)), createdAt: Date.now() };
        const target = this.turn(turnId);
        if (target !== turn || target.status !== 'working') throw Error(`Turn changed while settling: ${turnId}`);
        target.status = 'completed';
        target.summary = summary;
        delete target.pause;
        target.updated = summary.createdAt;
        this.touch(target);
        return summary;
    }

    /**
     * EN: Keeps a compact outcome when a foreground Turn yields.
     * ZH: 前台 Turn 让位时保留紧凑 outcome，供后续目标恢复使用。
     */
    public async interrupt(turnId: string, input: Settle, signal?: AbortSignal): Promise<Summary> {
        const turn = this.turn(turnId);
        if (turn.status !== 'working') throw Error(`Turn is not working: ${turnId}`);
        if (signal?.aborted) return this.suspendWithSummary(turnId, turn, input);
        const messages = [
            { role: AgentChatRole.System, content: this.prompt.section('SETTLE') },
            {
                role: AgentChatRole.User,
                content: JSON.stringify({ ...input, interrupted: true, current: this.briefTurn(turn), workspace: this.brief().workspace }),
            },
        ];
        const requestController = new AbortController();
        const abortRequest = () => requestController.abort();
        signal?.addEventListener('abort', abortRequest, { once: true });
        const timer = setTimeout(() => requestController.abort(), Context.InterruptTimeoutMs);
        let raceTimer: ReturnType<typeof setTimeout> | undefined;
        const request = this.intelligence.completeText(messages, requestController.signal);
        // A provider may ignore cancellation; observing the rejection prevents a
        // late promise from becoming an unhandled error after the fallback wins.
        request.catch(() => undefined);
        try {
            const raw = await Promise.race([
                request,
                new Promise<never>((_, reject) => {
                    raceTimer = setTimeout(() => reject(Error('Context interruption timed out')), Context.InterruptTimeoutMs);
                }),
            ]);
            if (signal?.aborted) return this.suspendWithSummary(turnId, turn, input);
            const summary = { ...this.compactSummary(parse<unknown>(raw)), createdAt: Date.now() };
            return this.suspendWithSummary(turnId, turn, input, summary);
        } catch {
            return this.suspendWithSummary(turnId, turn, input);
        } finally {
            clearTimeout(timer);
            if (raceTimer !== undefined) clearTimeout(raceTimer);
            signal?.removeEventListener('abort', abortRequest);
        }
    }

    public forgetSpeaker(speakerId: string): void {
        this.turns = this.turns.filter((turn) => turn.speakerId !== speakerId);
    }

    private draft(value: unknown): TurnDraft {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('INGEST output must be an object');
        const data = value as Record<string, unknown>;
        const intent = data.intent;
        if (intent !== 'reply' && intent !== 'research' && intent !== 'coordinate') throw Error('INGEST intent is invalid');
        if (typeof data.goal !== 'string') throw Error('INGEST goal is invalid');
        if (!Array.isArray(data.constraints) || !data.constraints.every((item) => typeof item === 'string')) throw Error('INGEST constraints are invalid');
        if (!Array.isArray(data.refs) || !data.refs.every((item) => this.reference(item))) throw Error('INGEST refs are invalid');
        if (!Array.isArray(data.done) || !data.done.every((item) => typeof item === 'string')) throw Error('INGEST done is invalid');
        if (!Array.isArray(data.open) || !data.open.every((item) => typeof item === 'string')) throw Error('INGEST open is invalid');
        if (typeof data.investigate !== 'boolean') throw Error('INGEST investigate is invalid');
        if (data.cwd !== undefined && typeof data.cwd !== 'string') throw Error('INGEST cwd is invalid');
        if (data.output !== undefined && (typeof data.output !== 'string' || data.output.length > 256)) throw Error('INGEST output is invalid');
        return {
            intent,
            goal: this.compactText(data.goal, 512),
            cwd: typeof data.cwd === 'string' ? this.compactText(data.cwd, 1024) : undefined,
            constraints: this.compactList(data.constraints),
            output: typeof data.output === 'string' ? this.compactText(data.output, 256) : undefined,
            refs: data.refs.slice(0, 32).map((item) => {
                const ref = item as { type: TurnDraft['refs'][number]['type']; value: string };
                return { type: ref.type, value: this.compactText(ref.value, 512) };
            }),
            done: this.compactList(data.done),
            open: this.compactList(data.open),
            investigate: data.investigate,
        };
    }

    private reference(value: unknown): value is TurnDraft['refs'][number] {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>;
        return (item.type === 'path' || item.type === 'error' || item.type === 'command' || item.type === 'symbol' || item.type === 'text')
            && typeof item.value === 'string';
    }

    private begin(current: TurnDraft, meta: Pick<Ingest, 'speakerId' | 'stimulusId'>): Turn {
        if (this.foreground()) throw Error('A turn is already occupying the foreground');
        this.evictForCapacity();
        const now = Date.now();
        this.sequence += 1;
        const turn: Turn = {
            ...current,
            id: `turn_${this.sequence}`,
            speakerId: meta.speakerId,
            stimulusId: meta.stimulusId,
            status: 'working',
            ts: now,
        };
        this.turns.push(turn);
        return turn;
    }

    private evictForCapacity(): void {
        while (this.turns.length >= Context.Capacity) {
            const index = this.turns.findIndex((turn) => turn.status === 'completed');
            if (index < 0) throw Error('Context working set is full');
            this.turns.splice(index, 1);
        }
    }

    private touch(turn: Turn): void {
        const index = this.turns.indexOf(turn);
        if (index >= 0 && index !== this.turns.length - 1) {
            this.turns.splice(index, 1);
            this.turns.push(turn);
        }
    }

    private suspendWithSummary(turnId: string, expected: Turn, input: Settle, summary?: Summary): Summary {
        const target = this.turn(turnId);
        if (target !== expected || target.status !== 'working') throw Error(`Turn changed while interrupting: ${turnId}`);
        const compact = summary ?? {
            goal: this.compactText(target.goal, 512),
            result: input.assistant.length > 0 ? this.compactText(input.assistant, 2000) : 'Turn interrupted before a final answer.',
            changedFiles: [],
            decisions: this.compactList(input.decisions),
            evidence: this.compactList(input.evidence),
            remaining: this.compactList(input.remaining ?? target.open),
            createdAt: Date.now(),
        };
        target.status = 'suspended';
        target.summary = compact;
        delete target.pause;
        target.updated = compact.createdAt;
        this.touch(target);
        return compact;
    }

    private compactSummary(value: unknown): Omit<Summary, 'createdAt'> {
        const data = typeof value === 'object' && value !== null && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {};
        return {
            goal: typeof data.goal === 'string' ? this.compactText(data.goal, 512) : '',
            result: typeof data.result === 'string' ? this.compactText(data.result, 2000) : '',
            changedFiles: this.compactList(data.changedFiles, 256, 32),
            decisions: this.compactList(data.decisions, 256, 32),
            evidence: this.compactList(data.evidence, 256, 32),
            remaining: this.compactList(data.remaining, 256, 32),
        };
    }

    private compactText(value: string, maxLength: number): string {
        return value.slice(0, maxLength);
    }

    private compactList(value: unknown, maxLength = 256, maxItems = 32): string[] {
        return Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, maxItems).map((entry) => this.compactText(entry, maxLength))
            : [];
    }

}
