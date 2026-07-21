import { describe, expect, test } from 'bun:test';
import { Context } from './component';
import type { TurnDraft } from './types';

const draft = (goal: string): TurnDraft => ({
    intent: 'research',
    goal,
    constraints: [],
    refs: [],
    done: [],
    open: [],
    investigate: false,
});

const draftJson = (goal: string): string => JSON.stringify({ ...draft(goal), investigate: true });

/**
 * The ingest/settle tests exercise prompt-derived semantics; the focused
 * lifecycle tests below use small drafts to isolate deterministic capacity and
 * foreground invariants without making another model request.
 */
describe('Context', () => {
    test('lands one user message, lets the LLM settle a summary in its own words, and marks the turn complete', async () => {
        const context = new Context();
        context.prompt = { section: () => 'settle prompt' } as never;
        let request = 0;
        context.intelligence = {
            completeText: async () => {
                request += 1;
                return request === 1
                    ? JSON.stringify({
                        intent: 'research',
                        goal: 'flatten the turn shape',
                        constraints: [],
                        refs: [],
                        done: [],
                        open: [],
                        investigate: true,
                    })
                    : JSON.stringify({
                        goal: 'flatten the turn shape',
                        result: 'context keeps one truth',
                        changedFiles: ['src/agent/context/component.ts'],
                        decisions: ['turn owns summary'],
                        evidence: ['ingest kept user text verbatim'],
                        remaining: ['no parallel completed array'],
                    });
            },
        } as never;

        const userMessage = '简化 Context';
        const settled = await context.ingest({ text: userMessage, speakerId: 'test' });
        const summary = await context.settle(settled.id, { assistant: '已把 turn 拍平' });

        expect(context.turns.length).toBeGreaterThan(0);
        expect(summary?.result).toContain('context');
        expect(context.turns.at(-1)?.status).toBe('completed');
        expect(context.turns.at(-1)?.summary?.result).toContain('context');
        expect(JSON.stringify(context.turns)).not.toContain(userMessage);
        expect(JSON.stringify(context.turns)).not.toContain('"role":"tool"');
        expect(JSON.stringify(context.turns)).not.toContain('tool_call_id');
    });

    test('briefs an agent with the current turn understanding, not the raw conversation', async () => {
        const context = new Context();
        context.prompt = { section: () => 'ingest prompt' } as never;
        context.intelligence = {
            completeText: async () => JSON.stringify({
                intent: 'research',
                goal: 'flatten the turn shape',
                cwd: '/tmp/flyflor',
                constraints: ['keep one truth'],
                refs: [{ type: 'path', value: 'src/agent/context/component.ts' }],
                done: [],
                open: [],
                investigate: true,
            }),
        } as never;

        await context.ingest({ text: '简化 Context', speakerId: 'test' });
        const brief = context.brief();

        expect(brief.intent).toBe('research');
        expect(brief.goal).toContain('flatten');
        expect(brief.constraints).toContain('keep one truth');
        expect(brief.refs[0]?.value).toBe('src/agent/context/component.ts');
        expect(brief.done).toEqual([]);
        expect(brief.workspace).toHaveLength(1);
    });

    test('keeps four semantic slots and evicts the oldest completed slot first', () => {
        const context = new Context();
        const turns = Array.from({ length: Context.Capacity }, (_, index) => {
            const turn = context.load(draft(`goal-${index}`), { speakerId: `speaker-${index}` });
            turn.status = 'completed';
            return turn;
        });

        const newcomer = context.load(draft('goal-new'), { speakerId: 'speaker-new' });

        expect(context.turns).toHaveLength(Context.Capacity);
        expect(context.turns.map((turn) => turn.id)).toEqual([
            turns[1]!.id,
            turns[2]!.id,
            turns[3]!.id,
            newcomer.id,
        ]);
        expect(context.hasCapacity()).toBe(true);
    });

    test('protects suspended slots when a completed slot is available for eviction', () => {
        const context = new Context();
        const protectedTurns = Array.from({ length: Context.Capacity - 1 }, (_, index) => {
            const turn = context.load(draft(`suspended-${index}`), { speakerId: `speaker-${index}` });
            turn.status = 'suspended';
            return turn;
        });
        const completed = context.load(draft('completed'), { speakerId: 'speaker-completed' });
        completed.status = 'completed';

        const newcomer = context.load(draft('new'), { speakerId: 'speaker-new' });

        expect(context.turns.map((turn) => turn.id)).toEqual([
            ...protectedTurns.map((turn) => turn.id),
            newcomer.id,
        ]);
        expect(context.turns).not.toContain(completed);
    });

    test('does not admit a new turn while working or waiting occupies the foreground', () => {
        for (const status of ['working', 'waiting'] as const) {
            const context = new Context();
            const active = context.load(draft(status), { speakerId: 'speaker' });
            active.status = status;

            expect(() => context.load(draft('next'), { speakerId: 'other' })).toThrow(/foreground/);
            expect(context.turns).toEqual([active]);
        }
    });

    test('does not expire a turn because its timestamps are old', () => {
        const context = new Context();
        const turn = context.load(draft('old but relevant'), { speakerId: 'speaker' });
        turn.status = 'completed';
        turn.ts = 1;
        turn.updated = 1;

        expect(context.turn(turn.id)).toBe(turn);
        expect(context.recent().map((item) => item.id)).toEqual([turn.id]);
        expect(context.hasCapacity()).toBe(true);
    });

    test('revises a turn in place while preserving its id and speaker', async () => {
        const context = new Context();
        context.prompt = { section: () => 'ingest prompt' } as never;
        context.intelligence = {
            completeText: async () => draftJson('revised goal'),
        } as never;
        const original = context.load(draft('original goal'), {
            speakerId: 'speaker-a',
            stimulusId: 'stimulus-a',
        });
        original.status = 'completed';

        const revised = await context.revise(original.id, {
            text: 'follow up',
            speakerId: 'speaker-a',
            stimulusId: 'stimulus-b',
        });

        expect(revised).toBe(original);
        expect(revised.id).toBe(original.id);
        expect(revised.speakerId).toBe('speaker-a');
        expect(revised.stimulusId).toBe('stimulus-b');
        expect(revised.goal).toBe('revised goal');
        expect(revised.status).toBe('working');
    });

    test('does not revive a turn after another foreground turn starts during revision', async () => {
        const context = new Context();
        context.prompt = { section: () => 'ingest prompt' } as never;
        const resolvers: Array<(value: string) => void> = [];
        context.intelligence = {
            completeText: () => new Promise<string>((resolve) => resolvers.push(resolve)),
        } as never;
        const original = context.load(draft('original goal'), { speakerId: 'speaker-a' });
        original.status = 'completed';

        const revision = context.revise(original.id, {
            text: 'follow up',
            speakerId: 'speaker-a',
            stimulusId: 'stimulus-revision',
        });
        await Promise.resolve();
        const ingest = context.ingest({ text: 'independent request', speakerId: 'speaker-b' });
        await Promise.resolve();

        expect(resolvers).toHaveLength(2);
        resolvers[1]!(draftJson('independent goal'));
        const newcomer = await ingest;
        resolvers[0]!(draftJson('revised goal'));

        await expect(revision).rejects.toThrow('Turn changed while revising');
        expect(original.status).toBe('completed');
        expect(context.foreground()?.id).toBe(newcomer.id);
    });

    test('falls back to a bounded suspended outcome when interruption is already aborted', async () => {
        const context = new Context();
        const turn = context.load(draft('interrupt safely'), { speakerId: 'speaker' });
        const controller = new AbortController();
        controller.abort();

        const summary = await context.interrupt(turn.id, {
            assistant: 'partial progress',
            decisions: Array.from({ length: 40 }, (_, index) => `decision-${index}`),
            evidence: Array.from({ length: 40 }, (_, index) => `evidence-${index}`),
            remaining: Array.from({ length: 40 }, (_, index) => `remaining-${index}`),
        }, controller.signal);

        expect(turn.status).toBe('suspended');
        expect(summary.result).toBe('partial progress');
        expect(summary.decisions).toHaveLength(32);
        expect(summary.evidence).toHaveLength(32);
        expect(summary.remaining).toHaveLength(32);
    });
});
