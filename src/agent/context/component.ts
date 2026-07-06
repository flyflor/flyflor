import { AgentChatRole } from '@/agent/types';
import { FComponent, Inject, Prompt, PromptService, Singleton } from '@/core';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { parse } from '@/agent/json';
import type { AgentBrief, Ingest, Pause, Settle, Summary, Turn } from './types';

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
    public current?: Omit<Turn, 'id' | 'status' | 'ts'>;

    @Inject()
    public intelligence!: Intelligence;

    public turns: Turn[] = [];

    @Prompt('prompts/context')
    public prompt!: PromptService;

    public load(current: Omit<Turn, 'id' | 'status' | 'ts'>): Turn {
        this.current = current;
        return this.begin(current);
    }

    public recent(limit = 4): Turn[] {
        return this.turns.slice(-limit);
    }

    /**
     * EN: Produces a scoped briefing for one agent. It contains only the current
     * turn understanding and recent completed summaries, not the raw conversation.
     * ZH: 为一个 agent 生成范围简报。只包含当前 turn 理解和最近完成的摘要，不含原始对话。
     */
    public brief(forAgent: string): AgentBrief {
        const current = this.current;
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
            turnId: this.active()?.id ?? 'none',
            intent: current.intent,
            goal: current.goal,
            constraints: [...current.constraints],
            refs: current.refs.map((ref) => ({ ...ref })),
            cwd: current.cwd,
            recentSummaries: this.doneSummaries(),
        };
    }

    private doneSummaries(): Summary[] {
        return this.turns
            .filter((turn) => turn.status === 'completed')
            .map((turn) => turn.summary)
            .filter((summary): summary is Summary => summary !== undefined);
    }

    public async ingest(input: Ingest): Promise<Turn> {
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('INGEST') },
            { role: AgentChatRole.User, content: JSON.stringify({ latest: input.text, current: this.current, recent: this.recent() }) },
        ]);
        const draft: Omit<Turn, 'id' | 'status' | 'ts'> = { ...parse<Omit<Turn, 'user' | 'id' | 'status' | 'ts'>>(raw), user: input.text };
        const paused = this.active();
        if (paused) this.resume(paused);
        this.current = draft;
        return this.begin(draft);
    }

    public pause(input: Pause): void {
        const turn = this.active();
        if (!turn) return;
        turn.pause = input;
        turn.updated = Date.now();
    }

    public resume(turn = this.active()): void {
        if (!turn) return;
        delete turn.pause;
        turn.updated = Date.now();
    }

    public async settle(input: Settle): Promise<Summary | undefined> {
        const turn = this.active();
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('SETTLE') },
            {
                role: AgentChatRole.User,
                content: JSON.stringify({ ...input, current: this.current, recent: this.recent() }),
            },
        ]);
        const summary = { ...parse<Omit<Summary, 'createdAt'>>(raw), createdAt: Date.now() };
        if (turn) {
            turn.status = 'completed';
            turn.summary = summary;
            turn.assistant = input.assistant;
            delete turn.pause;
            turn.updated = summary.createdAt;
        }
        return summary;
    }

    private begin(current: Omit<Turn, 'id' | 'status' | 'ts'>): Turn {
        const now = Date.now();
        const turn: Turn = {
            ...current,
            id: `turn_${this.turns.length + 1}`,
            status: 'working',
            ts: now,
        };
        this.turns.push(turn);
        return turn;
    }

    private active(): Turn | undefined {
        const turn = this.turns.at(-1);
        return turn?.status === 'completed' ? undefined : turn;
    }
}
