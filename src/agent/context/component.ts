import { AgentChatRole } from '@/agent/types';
import { FComponent, Inject, Prompt, PromptService, Singleton } from '@/core';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { parse } from '@/agent/json';
import type { AgentBrief, Ingest, Pause, Settle, Summary, Turn, TurnDraft } from './types';

@Singleton()
/**
 * EN: Context owns every turn the life-form has ever heard.
 * ZH: Context 持有这个生命体听到过的每一条 turn。
 *
 * EN: `current` is the latest active turn; `turns` is the durable record.
 * Settlement flips `status` and writes `summary` directly on the turn — no
 * parallel completed array, no separate snapshot file.
 * ZH: `current` 是当前活动 turn,`turns` 是持久记录。settle 直接翻 status 并把
 * summary 写在 turn 上 — 不维护平行 completed 数组,也不写 snapshot 文件。
 */
export class Context extends FComponent {
    private sequence = 0;

    @Inject()
    public intelligence!: Intelligence;

    public turns: Turn[] = [];

    @Prompt('prompts/context')
    public prompt!: PromptService;

    public load(current: TurnDraft): Turn {
        return this.begin(current);
    }

    public recent(limit = 4): Turn[] {
        return structuredClone(this.turns.slice(-limit));
    }

    public turn(id: string): Turn {
        const turn = this.turns.find((candidate) => candidate.id === id);
        if (!turn) throw Error(`Turn not found: ${id}`);
        return turn;
    }

    public working(): Turn | undefined {
        return this.turns.findLast((turn) => turn.status === 'working');
    }

    /**
     * EN: Produces a scoped briefing for one agent. It contains only the current
     * turn understanding and recent completed summaries, not the raw conversation.
     * ZH: 为一个 agent 生成范围简报。只包含当前 turn 理解和最近完成的摘要，不含原始对话。
     */
    public brief(turnId?: string): AgentBrief {
        const current = turnId ? this.turn(turnId) : this.working();
        if (!current) {
            return {
                turnId: 'none',
                intent: 'research',
                goal: '',
                constraints: [],
                refs: [],
                recentSummaries: this.doneSummaries(),
            };
        }
        return {
            turnId: current.id,
            intent: current.intent,
            goal: current.goal,
            constraints: [...current.constraints],
            refs: current.refs.map((ref) => ({ ...ref })),
            cwd: current.cwd,
            recentSummaries: this.doneSummaries(),
        };
    }

    private doneSummaries(): Summary[] {
        return structuredClone(this.turns
            .filter((turn) => turn.status === 'completed')
            .map((turn) => turn.summary)
            .filter((summary): summary is Summary => summary !== undefined));
    }

    public async ingest(input: Ingest): Promise<Turn> {
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('INGEST') },
            { role: AgentChatRole.User, content: JSON.stringify({ latest: input.text, current: this.working(), recent: this.recent() }) },
        ]);
        const draft = this.draft(parse<unknown>(raw), input.text);
        return this.begin(draft);
    }

    public pause(turnId: string, input: Pause): void {
        const turn = this.turn(turnId);
        if (turn.status !== 'working') throw Error(`Turn is not working: ${turnId}`);
        turn.pause = input;
        turn.updated = Date.now();
    }

    public resume(turnId: string, pauseId: string): void {
        const turn = this.turn(turnId);
        if (turn.status !== 'working') throw Error(`Turn is not working: ${turnId}`);
        if (turn.pause?.id !== pauseId) throw Error(`Pause does not match turn: ${turnId}`);
        delete turn.pause;
        turn.updated = Date.now();
    }

    public async settle(turnId: string, input: Settle): Promise<Summary> {
        const turn = this.turn(turnId);
        if (turn.status !== 'working') throw Error(`Turn is not working: ${turnId}`);
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('SETTLE') },
            {
                role: AgentChatRole.User,
                content: JSON.stringify({ ...input, current: turn, recent: this.recent() }),
            },
        ]);
        const summary = { ...parse<Omit<Summary, 'createdAt'>>(raw), createdAt: Date.now() };
        const target = this.turn(turnId);
        if (target !== turn || target.status !== 'working') throw Error(`Turn changed while settling: ${turnId}`);
        target.status = 'completed';
        target.summary = summary;
        target.assistant = input.assistant;
        delete target.pause;
        target.updated = summary.createdAt;
        return summary;
    }

    private draft(value: unknown, user: string): TurnDraft {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('INGEST output must be an object');
        const data = value as Record<string, unknown>;
        const intent = data.intent;
        if (intent !== 'reply' && intent !== 'research' && intent !== 'soul') throw Error('INGEST intent is invalid');
        if (typeof data.goal !== 'string') throw Error('INGEST goal is invalid');
        if (!Array.isArray(data.constraints) || !data.constraints.every((item) => typeof item === 'string')) throw Error('INGEST constraints are invalid');
        if (!Array.isArray(data.refs) || !data.refs.every((item) => this.reference(item))) throw Error('INGEST refs are invalid');
        if (!Array.isArray(data.done) || !data.done.every((item) => typeof item === 'string')) throw Error('INGEST done is invalid');
        if (!Array.isArray(data.open) || !data.open.every((item) => typeof item === 'string')) throw Error('INGEST open is invalid');
        if (typeof data.investigate !== 'boolean') throw Error('INGEST investigate is invalid');
        if (data.cwd !== undefined && typeof data.cwd !== 'string') throw Error('INGEST cwd is invalid');
        if (data.output !== undefined && typeof data.output !== 'string') throw Error('INGEST output is invalid');
        return {
            user,
            intent,
            goal: data.goal,
            cwd: data.cwd as string | undefined,
            constraints: [...data.constraints],
            output: data.output as string | undefined,
            refs: data.refs.map((item) => ({ ...(item as { type: TurnDraft['refs'][number]['type']; value: string }) })),
            done: [...data.done],
            open: [...data.open],
            investigate: data.investigate,
        };
    }

    private reference(value: unknown): value is TurnDraft['refs'][number] {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>;
        return (item.type === 'path' || item.type === 'error' || item.type === 'command' || item.type === 'symbol' || item.type === 'text')
            && typeof item.value === 'string';
    }

    private begin(current: TurnDraft): Turn {
        if (this.working()) throw Error('A turn is already working');
        const now = Date.now();
        this.sequence += 1;
        const turn: Turn = {
            ...current,
            id: `turn_${this.sequence}`,
            status: 'working',
            ts: now,
        };
        this.turns.push(turn);
        return turn;
    }

}
