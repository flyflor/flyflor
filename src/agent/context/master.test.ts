import { describe, expect, test } from 'bun:test';
import { Context } from './component';
import { MasterContext } from './master';
import type { Summary, Turn, TurnDraft } from './types';

const summary = (result: string): Summary => ({
    goal: 'goal',
    result,
    changedFiles: [],
    decisions: [],
    evidence: [],
    remaining: ['leftover'],
    createdAt: Date.now(),
});

const turn = (id: string, speakerId: string): Turn => ({
    id,
    speakerId,
    intent: 'research',
    goal: `goal of ${id}`,
    constraints: [],
    refs: [],
    done: [],
    open: [],
    investigate: false,
    status: 'completed',
    ts: Date.now(),
});

const draft = (goal: string): TurnDraft => ({
    intent: 'research',
    goal,
    constraints: [],
    refs: [],
    done: [],
    open: [],
    investigate: false,
});

describe('MasterContext', () => {
    test('promotes a settled turn into the situation model', () => {
        const master = new MasterContext();

        master.promote(turn('turn_1', 'conn_1'), summary('done well'));

        expect(master.records).toHaveLength(1);
        expect(master.records[0]).toMatchObject({ turnId: 'turn_1', speakerId: 'conn_1' });
        expect(master.projection()[0]).toMatchObject({ speakerId: 'conn_1', result: 'done well', remaining: ['leftover'] });
    });

    test('is idempotent per turn id and refreshes the record position', () => {
        const master = new MasterContext();
        master.promote(turn('turn_1', 'conn_1'), summary('first'));
        master.promote(turn('turn_2', 'conn_2'), summary('second'));

        master.promote(turn('turn_1', 'conn_1'), summary('refreshed'));

        expect(master.records.map((record) => record.turnId)).toEqual(['turn_2', 'turn_1']);
        expect(master.records[1]?.summary.result).toBe('refreshed');
    });

    test('evicts the oldest record beyond capacity', () => {
        const master = new MasterContext();
        for (let index = 0; index < MasterContext.Capacity + 2; index += 1) {
            master.promote(turn(`turn_${index}`, 'conn_1'), summary(`result ${index}`));
        }

        expect(master.records).toHaveLength(MasterContext.Capacity);
        expect(master.records[0]?.turnId).toBe('turn_2');
    });

    test('drops every record owned by one speaker', () => {
        const master = new MasterContext();
        master.promote(turn('turn_1', 'conn_1'), summary('a'));
        master.promote(turn('turn_2', 'conn_2'), summary('b'));

        master.dropSpeaker('conn_1');

        expect(master.records.map((record) => record.speakerId)).toEqual(['conn_2']);
    });

    test('truncates projection entries to their bounds', () => {
        const master = new MasterContext();
        master.promote(turn('turn_1', 'conn_1'), {
            ...summary('x'.repeat(MasterContext.ResultMaxLength + 50)),
            remaining: Array.from({ length: 20 }, (_, index) => `item-${index}`),
        });

        const entry = master.projection()[0]!;
        expect(entry.result).toHaveLength(MasterContext.ResultMaxLength);
        expect(entry.remaining).toHaveLength(MasterContext.RemainingMaxItems);
    });
});

describe('Context consolidation', () => {
    test('settle promotes the summary into the master context', async () => {
        const context = new Context();
        context.master = new MasterContext();
        context.prompt = { section: () => 'prompt' } as never;
        context.intelligence = {
            completeText: async () => JSON.stringify({
                goal: 'g', result: 'settled result', changedFiles: [], decisions: [], evidence: [], remaining: [],
            }),
        } as never;
        const active = context.load(draft('goal'), { speakerId: 'conn_1' });

        await context.settle(active.id, { assistant: 'final' });

        expect(context.master.records).toHaveLength(1);
        expect(context.master.records[0]).toMatchObject({ turnId: active.id, summary: { result: 'settled result' } });
    });

    test('eviction consolidates a completed turn instead of dropping it silently', () => {
        const context = new Context();
        context.master = new MasterContext();
        const evicted: string[] = [];
        for (let index = 0; index < Context.Capacity; index += 1) {
            const item = context.load(draft(`goal-${index}`), { speakerId: `speaker-${index}` });
            item.status = 'completed';
            item.summary = summary(`result-${index}`);
            evicted.push(item.id);
        }

        context.load(draft('goal-new'), { speakerId: 'speaker-new' });

        expect(context.turns.some((item) => item.id === evicted[0])).toBe(false);
        expect(context.master.records.map((record) => record.turnId)).toContain(evicted[0]!);
        expect(context.masterProjection()[0]?.result).toBe('result-0');
    });

    test('forgetSpeaker drops both working-set turns and master records', () => {
        const context = new Context();
        context.master = new MasterContext();
        const item = context.load(draft('goal'), { speakerId: 'conn_1' });
        item.status = 'completed';
        item.summary = summary('result');
        context.master.promote(item, item.summary);

        context.forgetSpeaker('conn_1');

        expect(context.turns).toHaveLength(0);
        expect(context.master.records).toHaveLength(0);
    });

    test('suspended turns are not promoted by interruption', async () => {
        const context = new Context();
        context.master = new MasterContext();
        const active = context.load(draft('goal'), { speakerId: 'conn_1' });
        const controller = new AbortController();
        controller.abort();

        await context.interrupt(active.id, { assistant: 'partial' }, controller.signal);

        expect(active.status).toBe('suspended');
        expect(context.master.records).toHaveLength(0);
    });
});
