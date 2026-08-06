import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useContainer } from '@/core';
import { LedgerRepository } from './repository';
import type { LedgerEvent } from './types';

const dirs: string[] = [];
const repositories: LedgerRepository[] = [];

const directory = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'flyflor-ledger-'));
    dirs.push(dir);
    return dir;
};

afterEach(() => {
    while (repositories.length) repositories.pop()!.close();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const repository = (dir: string): LedgerRepository => {
    const value = useContainer().create(LedgerRepository);
    value.open(dir);
    repositories.push(value);
    return value;
};

const monthKey = (timestamp: number): string => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const event = (overrides: Partial<LedgerEvent> = {}): LedgerEvent => ({
    id: crypto.randomUUID(),
    kind: 'stimulus',
    createdAt: Date.now(),
    payload: JSON.stringify({ hello: 'world' }),
    ...overrides,
});

const rows = (dir: string, month: string): Array<Record<string, unknown>> => {
    const db = new Database(join(dir, `ledger-${month}.db`), { readonly: true });
    try {
        return db.query('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown>>;
    } finally {
        db.close();
    }
};

const meta = (dir: string, month: string): Record<string, string> => {
    const db = new Database(join(dir, `ledger-${month}.db`), { readonly: true });
    try {
        const entries = db.query('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>;
        return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
    } finally {
        db.close();
    }
};

describe('LedgerRepository', () => {
    test('creates the current month shard eagerly on open', () => {
        const dir = directory();
        repository(dir);
        const month = monthKey(Date.now());

        expect(readdirSync(dir)).toContain(`ledger-${month}.db`);
        expect(meta(dir, month)).toMatchObject({ schema_version: '1', shard: month });
    });

    test('appends events verbatim into their monthly shard', () => {
        const dir = directory();
        const repo = repository(dir);
        const first = event({ focusId: 'focus_1', messageId: 'm1', speakerId: 'speaker-a' });
        const second = event({ kind: 'turn', payload: JSON.stringify({ nested: { text: '逐字内容'.repeat(100) } }) });
        repo.insert(first);
        repo.insert(second);

        const stored = rows(dir, monthKey(Date.now()));
        expect(stored).toHaveLength(2);
        expect(stored[0]).toMatchObject({
            id: first.id,
            kind: 'stimulus',
            created_at: first.createdAt,
            focus_id: 'focus_1',
            message_id: 'm1',
            speaker_id: 'speaker-a',
        });
        expect(stored[1]).toMatchObject({ id: second.id, kind: 'turn', focus_id: null, message_id: null, speaker_id: null });
        expect(JSON.parse(stored[1]!.payload as string)).toEqual({ nested: { text: '逐字内容'.repeat(100) } });
    });

    test('routes straggler events into their own month and seals evicted shards', () => {
        const dir = directory();
        const repo = repository(dir);
        const january = new Date(2020, 0, 15).getTime();
        const february = new Date(2020, 1, 15).getTime();
        repo.insert(event({ createdAt: january, messageId: 'late-january' }));
        repo.insert(event({ createdAt: february, messageId: 'late-february' }));

        expect(readdirSync(dir)).toEqual(expect.arrayContaining(['ledger-2020-01.db', 'ledger-2020-02.db']));
        expect(rows(dir, '2020-01').map((row) => row.message_id)).toEqual(['late-january']);
        expect(rows(dir, '2020-02').map((row) => row.message_id)).toEqual(['late-february']);
        expect(meta(dir, '2020-01').sealed_at).toBeDefined();
        expect(meta(dir, '2020-02').sealed_at).toBeUndefined();
        expect(meta(dir, monthKey(Date.now())).sealed_at).toBeUndefined();
    });

    test('reopens an existing shard idempotently and keeps appending', () => {
        const dir = directory();
        const first = repository(dir);
        first.insert(event({ messageId: 'before-close' }));
        first.close();
        repositories.length = 0;

        const second = repository(dir);
        second.insert(event({ messageId: 'after-reopen' }));

        const stored = rows(dir, monthKey(Date.now()));
        expect(stored.map((row) => row.message_id)).toEqual(['before-close', 'after-reopen']);
        expect(meta(dir, monthKey(Date.now())).schema_version).toBe('1');
    });
});
