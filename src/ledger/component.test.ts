import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInteractionRequest, AgentReport } from '@/agent/types';
import type { Focus, Stimulus } from '@/collective/context/types';
import type { ConfigService } from '@/configuration';
import { useContainer } from '@/core';
import { Ledger } from './component';
import { LedgerRepository } from './repository';

const dirs: string[] = [];
const ledgers: Ledger[] = [];

const directory = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'flyflor-ledger-'));
    dirs.push(dir);
    return dir;
};

afterEach(() => {
    while (ledgers.length) ledgers.pop()!.repository.close();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const ledger = (dir: string, enabled = true, open = true): Ledger => {
    const component = useContainer().create(Ledger);
    component.config = { ledger: { enabled, directory: dir } } as ConfigService;
    component.repository = useContainer().create(LedgerRepository);
    if (enabled && open) component.init();
    ledgers.push(component);
    return component;
};

const monthKey = (timestamp: number): string => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const rows = (dir: string, month: string): Array<Record<string, unknown>> => {
    const db = new Database(join(dir, `ledger-${month}.db`), { readonly: true });
    try {
        return db.query('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown>>;
    } finally {
        db.close();
    }
};

const stimulus = (messageId: string, receivedAt = Date.now()): Stimulus => ({
    messageId,
    speakerId: 'speaker-a',
    connectionId: 'connection-a',
    text: `text of ${messageId}`,
    receivedAt,
});

const focus = (id: string): Focus => ({
    id,
    revision: 1,
    ownerSpeakerId: 'speaker-a',
    state: 'completed',
    stimuli: [stimulus('m1')],
    participants: [{ speakerId: 'speaker-a', connectionIds: ['connection-a'] }],
    consultants: [],
    goal: 'the verbatim goal',
    constraints: [],
    references: [],
    createdAt: 1,
    updatedAt: 2,
});

const report = (answer: string): AgentReport => ({ agentId: 'flyflor', answer, evidence: [], remaining: [], steps: 1 });

describe('Ledger', () => {
    test('records every conversation lifecycle event with verbatim payloads', () => {
        const dir = directory();
        const value = ledger(dir);
        const interaction: AgentInteractionRequest = {
            focusId: 'focus_1',
            revision: 1,
            requestId: 'confirm_1',
            agentId: 'flyflor',
            kind: 'confirm',
            data: { question: 'Proceed?' },
        };
        const longAnswer = '逐字'.repeat(10000);

        value.recordStimulus(stimulus('m1'));
        value.recordTurn(focus('focus_1'), report(longAnswer));
        value.recordInteraction(interaction, { kind: 'confirm', approved: true }, 'speaker-a', 'answer-1');
        value.recordCancellation('focus_0', 3, 'speaker-a');
        value.recordAgentEvent({ agentId: 'flyflor', focusId: 'focus_1', revision: 1, type: 'action_result', data: { evidence: 'shell ok' } });

        const stored = rows(dir, monthKey(Date.now()));
        expect(stored.map((row) => row.kind)).toEqual(['stimulus', 'turn', 'interaction', 'cancellation', 'agent_event']);

        expect(stored[0]).toMatchObject({ message_id: 'm1', speaker_id: 'speaker-a' });
        expect(JSON.parse(stored[0]!.payload as string)).toMatchObject({ messageId: 'm1', text: 'text of m1' });

        expect(stored[1]).toMatchObject({ focus_id: 'focus_1', speaker_id: 'speaker-a' });
        const turn = JSON.parse(stored[1]!.payload as string);
        expect(turn.focus.goal).toBe('the verbatim goal');
        expect(turn.report.answer).toBe(longAnswer);

        expect(stored[2]).toMatchObject({ focus_id: 'focus_1', message_id: 'answer-1', speaker_id: 'speaker-a' });
        expect(JSON.parse(stored[2]!.payload as string)).toEqual({
            request: interaction,
            response: { kind: 'confirm', approved: true },
        });

        expect(stored[3]).toMatchObject({ focus_id: 'focus_0', speaker_id: 'speaker-a' });
        expect(JSON.parse(stored[3]!.payload as string)).toEqual({ focusId: 'focus_0', revision: 3, speakerId: 'speaker-a' });

        expect(JSON.parse(stored[4]!.payload as string)).toMatchObject({ type: 'action_result', data: { evidence: 'shell ok' } });
    });

    test('routes events into shards by their own timestamps', () => {
        const dir = directory();
        const value = ledger(dir);
        const january = new Date(2020, 0, 31, 23, 59).getTime();

        value.recordStimulus(stimulus('late-january', january));

        expect(rows(dir, '2020-01').map((row) => row.message_id)).toEqual(['late-january']);
    });

    test('does nothing when disabled', () => {
        const parent = directory();
        const dir = join(parent, 'never-created');
        const value = ledger(dir, false);

        value.recordStimulus(stimulus('m1'));
        value.recordTurn(focus('focus_1'), report('answer'));

        expect(existsSync(dir)).toBe(false);
    });

    test('swallows write failures instead of breaking the conversation', () => {
        const dir = directory();
        const value = ledger(dir, true, false);

        expect(() => value.recordTurn(focus('focus_1'), report('answer'))).not.toThrow();
        expect(existsSync(join(dir, `ledger-${monthKey(Date.now())}.db`))).toBe(false);
    });
});
