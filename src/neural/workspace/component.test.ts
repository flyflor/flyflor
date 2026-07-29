import { describe, expect, test } from 'bun:test';
import { Workspace } from './component';
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
describe('Workspace', () => {
    test('lands one user message, lets the LLM settle an outcome in its own words, and marks the turn complete', async () => {
        const workspace = new Workspace();
        workspace.prompt = { section: () => 'settle prompt' } as never;
        let request = 0;
        workspace.intelligence = {
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
                        result: 'workspace keeps one truth',
                        changedFiles: ['src/neural/workspace/component.ts'],
                        decisions: ['turn owns outcome'],
                        evidence: ['ingest kept user text verbatim'],
                        remaining: ['no parallel completed array'],
                    });
            },
        } as never;

        const userMessage = '简化 Workspace';
        const settled = await workspace.ingest({ text: userMessage, speakerId: 'test' });
        const outcome = await workspace.settle(settled.id, { assistant: '已把 turn 拍平' });

        expect(workspace.turns.length).toBeGreaterThan(0);
        expect(outcome?.result).toContain('workspace');
        expect(workspace.turns.at(-1)?.status).toBe('completed');
        expect(workspace.turns.at(-1)?.outcome?.result).toContain('workspace');
        expect('summary' in (workspace.turns.at(-1) ?? {})).toBe(false);
        expect(JSON.stringify(workspace.turns)).not.toContain(userMessage);
        expect(JSON.stringify(workspace.turns)).not.toContain('"role":"tool"');
        expect(JSON.stringify(workspace.turns)).not.toContain('tool_call_id');
    });

    test('briefs an agent with the current turn understanding, not the raw conversation', async () => {
        const workspace = new Workspace();
        workspace.prompt = { section: () => 'ingest prompt' } as never;
        workspace.intelligence = {
            completeText: async () => JSON.stringify({
                intent: 'research',
                goal: 'flatten the turn shape',
                cwd: '/tmp/flyflor',
                constraints: ['keep one truth'],
                refs: [{ type: 'path', value: 'src/neural/workspace/component.ts' }],
                done: [],
                open: [],
                investigate: true,
            }),
        } as never;

        await workspace.ingest({ text: '简化 Workspace', speakerId: 'test' });
        const brief = workspace.brief();

        expect(brief.intent).toBe('research');
        expect(brief.goal).toContain('flatten');
        expect(brief.constraints).toContain('keep one truth');
        expect(brief.refs[0]?.value).toBe('src/neural/workspace/component.ts');
        expect(brief.done).toEqual([]);
        expect(brief.workspace).toHaveLength(1);
        expect(brief.situation).toEqual([]);
        expect('master' in brief).toBe(false);
    });

    test('keeps four semantic slots and evicts the oldest completed slot first', () => {
        const workspace = new Workspace();
        const turns = Array.from({ length: Workspace.Capacity }, (_, index) => {
            const turn = workspace.load(draft(`goal-${index}`), { speakerId: `speaker-${index}` });
            turn.status = 'completed';
            return turn;
        });

        const newcomer = workspace.load(draft('goal-new'), { speakerId: 'speaker-new' });

        expect(workspace.turns).toHaveLength(Workspace.Capacity);
        expect(workspace.turns.map((turn) => turn.id)).toEqual([
            turns[1]!.id,
            turns[2]!.id,
            turns[3]!.id,
            newcomer.id,
        ]);
        expect(workspace.hasCapacity()).toBe(true);
    });

    test('protects suspended slots when a completed slot is available for eviction', () => {
        const workspace = new Workspace();
        const protectedTurns = Array.from({ length: Workspace.Capacity - 1 }, (_, index) => {
            const turn = workspace.load(draft(`suspended-${index}`), { speakerId: `speaker-${index}` });
            turn.status = 'suspended';
            return turn;
        });
        const completed = workspace.load(draft('completed'), { speakerId: 'speaker-completed' });
        completed.status = 'completed';

        const newcomer = workspace.load(draft('new'), { speakerId: 'speaker-new' });

        expect(workspace.turns.map((turn) => turn.id)).toEqual([
            ...protectedTurns.map((turn) => turn.id),
            newcomer.id,
        ]);
        expect(workspace.turns).not.toContain(completed);
    });

    test('does not admit a new turn while working or waiting occupies the foreground', () => {
        for (const status of ['working', 'waiting'] as const) {
            const workspace = new Workspace();
            const active = workspace.load(draft(status), { speakerId: 'speaker' });
            active.status = status;

            expect(() => workspace.load(draft('next'), { speakerId: 'other' })).toThrow(/foreground/);
            expect(workspace.turns).toEqual([active]);
        }
    });

    test('does not expire a turn because its timestamps are old', () => {
        const workspace = new Workspace();
        const turn = workspace.load(draft('old but relevant'), { speakerId: 'speaker' });
        turn.status = 'completed';
        turn.ts = 1;
        turn.updated = 1;

        expect(workspace.turn(turn.id)).toBe(turn);
        expect(workspace.recent().map((item) => item.id)).toEqual([turn.id]);
        expect(workspace.hasCapacity()).toBe(true);
    });

    test('revises a turn in place while preserving its id and speaker', async () => {
        const workspace = new Workspace();
        workspace.prompt = { section: () => 'ingest prompt' } as never;
        workspace.intelligence = {
            completeText: async () => draftJson('revised goal'),
        } as never;
        const original = workspace.load(draft('original goal'), {
            speakerId: 'speaker-a',
            stimulusId: 'stimulus-a',
        });
        original.status = 'completed';

        const revised = await workspace.revise(original.id, {
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
        const workspace = new Workspace();
        workspace.prompt = { section: () => 'ingest prompt' } as never;
        const resolvers: Array<(value: string) => void> = [];
        workspace.intelligence = {
            completeText: () => new Promise<string>((resolve) => resolvers.push(resolve)),
        } as never;
        const original = workspace.load(draft('original goal'), { speakerId: 'speaker-a' });
        original.status = 'completed';

        const revision = workspace.revise(original.id, {
            text: 'follow up',
            speakerId: 'speaker-a',
            stimulusId: 'stimulus-revision',
        });
        await Promise.resolve();
        const ingest = workspace.ingest({ text: 'independent request', speakerId: 'speaker-b' });
        await Promise.resolve();

        expect(resolvers).toHaveLength(2);
        resolvers[1]!(draftJson('independent goal'));
        const newcomer = await ingest;
        resolvers[0]!(draftJson('revised goal'));

        await expect(revision).rejects.toThrow('Turn changed while revising');
        expect(original.status).toBe('completed');
        expect(workspace.foreground()?.id).toBe(newcomer.id);
    });

    test('falls back to a bounded suspended outcome when interruption is already aborted', async () => {
        const workspace = new Workspace();
        const turn = workspace.load(draft('interrupt safely'), { speakerId: 'speaker' });
        const controller = new AbortController();
        controller.abort();

        const outcome = await workspace.interrupt(turn.id, {
            assistant: 'partial progress',
            decisions: Array.from({ length: 40 }, (_, index) => `decision-${index}`),
            evidence: Array.from({ length: 40 }, (_, index) => `evidence-${index}`),
            remaining: Array.from({ length: 40 }, (_, index) => `remaining-${index}`),
        }, controller.signal);

        expect(turn.status).toBe('suspended');
        expect(outcome.result).toBe('partial progress');
        expect(outcome.decisions).toHaveLength(32);
        expect(outcome.evidence).toHaveLength(32);
        expect(outcome.remaining).toHaveLength(32);
    });
});
