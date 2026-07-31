import { describe, expect, test } from 'bun:test';
import { Workspace, type Turn, type TurnDraft, type TurnOutcome } from '@/neural/workspace';
import { SituationModel } from './model';

const outcome = (result: string): TurnOutcome => ({
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

describe('SituationModel', () => {
    test('promotes a settled turn into the situation model', () => {
        const situation = new SituationModel();

        situation.promote(turn('turn_1', 'conn_1'), outcome('done well'));

        expect(situation.records).toHaveLength(1);
        expect(situation.records[0]).toMatchObject({ turnId: 'turn_1', speakerId: 'conn_1' });
        expect(situation.projection()[0]).toMatchObject({ speakerId: 'conn_1', result: 'done well', remaining: ['leftover'] });
    });

    test('is idempotent per turn id and refreshes the record position', () => {
        const situation = new SituationModel();
        situation.promote(turn('turn_1', 'conn_1'), outcome('first'));
        situation.promote(turn('turn_2', 'conn_2'), outcome('second'));

        situation.promote(turn('turn_1', 'conn_1'), outcome('refreshed'));

        expect(situation.records.map((record) => record.turnId)).toEqual(['turn_2', 'turn_1']);
        expect(situation.records[1]?.outcome.result).toBe('refreshed');
    });

    test('evicts the oldest record beyond capacity', () => {
        const situation = new SituationModel();
        for (let index = 0; index < SituationModel.Capacity + 2; index += 1) {
            situation.promote(turn(`turn_${index}`, 'conn_1'), outcome(`result ${index}`));
        }

        expect(situation.records).toHaveLength(SituationModel.Capacity);
        expect(situation.records[0]?.turnId).toBe('turn_2');
    });

    test('drops every record owned by one speaker', () => {
        const situation = new SituationModel();
        situation.promote(turn('turn_1', 'conn_1'), outcome('a'));
        situation.promote(turn('turn_2', 'conn_2'), outcome('b'));

        situation.dropSpeaker('conn_1');

        expect(situation.records.map((record) => record.speakerId)).toEqual(['conn_2']);
    });

    test('truncates projection entries to their bounds', () => {
        const situation = new SituationModel();
        situation.promote(turn('turn_1', 'conn_1'), {
            ...outcome('x'.repeat(SituationModel.ResultMaxLength + 50)),
            remaining: Array.from({ length: 20 }, (_, index) => `item-${index}`),
        });

        const entry = situation.projection()[0]!;
        expect(entry.result).toHaveLength(SituationModel.ResultMaxLength);
        expect(entry.remaining).toHaveLength(SituationModel.RemainingMaxItems);
    });
});

describe('Workspace consolidation', () => {
    test('settle promotes the outcome into the situation model', async () => {
        const workspace = new Workspace(new SituationModel());
        workspace.prompt = { section: () => 'prompt' } as never;
        workspace.intelligence = {
            completeText: async () => JSON.stringify({
                goal: 'g', result: 'settled result', changedFiles: [], decisions: [], evidence: [], remaining: [],
            }),
        } as never;
        const active = workspace.load(draft('goal'), { speakerId: 'conn_1' });

        await workspace.settle(active.id, { assistant: 'final' });

        expect(workspace.situation.records).toHaveLength(1);
        expect(workspace.situation.records[0]).toMatchObject({ turnId: active.id, outcome: { result: 'settled result' } });
    });

    test('eviction consolidates a completed turn instead of dropping it silently', () => {
        const workspace = new Workspace(new SituationModel());
        const evicted: string[] = [];
        for (let index = 0; index < Workspace.Capacity; index += 1) {
            const item = workspace.load(draft(`goal-${index}`), { speakerId: `speaker-${index}` });
            item.status = 'completed';
            item.outcome = outcome(`result-${index}`);
            evicted.push(item.id);
        }

        workspace.load(draft('goal-new'), { speakerId: 'speaker-new' });

        expect(workspace.turns.some((item) => item.id === evicted[0])).toBe(false);
        expect(workspace.situation.records.map((record) => record.turnId)).toContain(evicted[0]!);
        expect(workspace.situationProjection()[0]?.result).toBe('result-0');
    });

    test('forgetSpeaker drops both working-set turns and situation records', () => {
        const workspace = new Workspace(new SituationModel());
        const item = workspace.load(draft('goal'), { speakerId: 'conn_1' });
        item.status = 'completed';
        item.outcome = outcome('result');
        workspace.situation.promote(item, item.outcome);

        workspace.forgetSpeaker('conn_1');

        expect(workspace.turns).toHaveLength(0);
        expect(workspace.situation.records).toHaveLength(0);
    });

    test('suspended turns are not promoted by interruption', async () => {
        const workspace = new Workspace(new SituationModel());
        const active = workspace.load(draft('goal'), { speakerId: 'conn_1' });
        const controller = new AbortController();
        controller.abort();

        await workspace.interrupt(active.id, { assistant: 'partial' }, controller.signal);

        expect(active.status).toBe('suspended');
        expect(workspace.situation.records).toHaveLength(0);
    });
});
