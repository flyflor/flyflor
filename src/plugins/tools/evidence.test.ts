import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT_PATH } from '@/config';
import { useContainer } from '@/core';
import type { InvestigationObserveContext } from './tool.types';
import { CodeGraphPlugin, GlobPlugin, GrepPlugin, ReadFilePlugin, RtkPlugin } from './index';

const TEST_DIR = join(ROOT_PATH, '.tmp-investigation-tools');

afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('evidence tools', () => {
    test('read_file reads workspace text and rejects path escape', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'note.txt'), 'brain investigation evidence', 'utf8');
        const tool = await useContainer().getAsync(ReadFilePlugin);

        const result = await tool.execute({ path: '.tmp-investigation-tools/note.txt' });
        const escaped = await tool.execute({ path: '../outside.txt' });

        expect(result.ok).toBe(true);
        expect(result.summary).toContain('note.txt');
        expect(JSON.stringify(result.data)).toContain('brain investigation evidence');
        expect(escaped.ok).toBe(false);
        expect(escaped.code).toBe('read_failed');
    });

    test('plugins emit observable start and end signals during observation', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'signal.txt'), 'observable plugin signal', 'utf8');
        const tool = await useContainer().getAsync(ReadFilePlugin);
        const signals: string[] = [];
        const subscription = tool.subscribe((signal) => signals.push(signal.type));

        await tool.observe({ goal: 'read signal file', kind: 'file', path: '.tmp-investigation-tools/signal.txt' });
        subscription.unsubscribe();

        expect(signals).toEqual(['start', 'end']);
    });

    test('glob and grep collect bounded workspace evidence', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'a.ts'), 'export const BrainSignal = "investigation";\n', 'utf8');
        writeFileSync(join(TEST_DIR, 'b.ts'), 'export const Other = "quiet";\n', 'utf8');
        const glob = await useContainer().getAsync(GlobPlugin);
        const grep = await useContainer().getAsync(GrepPlugin);

        const files = await glob.execute({ pattern: '.tmp-investigation-tools/*.ts' });
        const matches = await grep.execute({ query: 'BrainSignal', include: '.tmp-investigation-tools/*.ts' });

        expect(files.ok).toBe(true);
        expect(JSON.stringify(files.data)).toContain('a.ts');
        expect(matches.ok).toBe(true);
        expect(JSON.stringify(matches.data)).toContain('BrainSignal');
    });

    test('external plugins return not_available when their binary is absent', async () => {
        const rtk = useContainer().create(MissingRtkPlugin);
        const codegraph = useContainer().create(MissingCodeGraphPlugin);

        await expect(rtk.execute({ args: ['status'] })).resolves.toMatchObject({ ok: false, code: 'not_available' });
        await expect(codegraph.execute({ args: ['status'] })).resolves.toMatchObject({ ok: false, code: 'not_available' });
    });

    test('rtk pipe wraps file observations when available and falls back when missing', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'rtk'), '', 'utf8');
        const available = useContainer().create(CapturingRtkPlugin);
        const missing = useContainer().create(MissingRtkPlugin);
        const context: InvestigationObserveContext = { rootPath: ROOT_PATH };
        const fallback = {
            ok: true,
            source: 'read_file',
            pipes: [],
            code: 'ok',
            summary: 'fallback read',
            evidence: ['fallback'],
        };

        const compressed = await available.pipeObservation(async () => fallback, {
            goal: 'compress file read',
            kind: 'file',
            path: '.tmp-investigation-tools/note.txt',
            pipes: ['rtk'],
        }, context);
        const fallbackObservation = await missing.pipeObservation(async () => fallback, {
            goal: 'compress file read',
            kind: 'file',
            path: '.tmp-investigation-tools/note.txt',
            pipes: ['rtk'],
        }, context);

        expect(available.commands).toEqual([['read', '.tmp-investigation-tools/note.txt']]);
        expect(compressed).toMatchObject({ ok: true, source: 'rtk', pipes: ['rtk'] });
        expect(fallbackObservation).toMatchObject({ ok: true, source: 'read_file' });
        expect(JSON.stringify(fallbackObservation.data)).toContain('pipe_missing');
    });

    test('codegraph initializes a missing workspace index before semantic queries', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'codegraph'), '', 'utf8');
        const codegraph = useContainer().create(CapturingCodeGraphPlugin);

        const result = await codegraph.observe({ goal: 'find symbol', kind: 'code_symbol', query: 'Brain' }, { rootPath: TEST_DIR });

        expect(result.ok).toBe(true);
        expect(codegraph.commands).toEqual([
            ['init', '-i'],
            ['query', 'Brain', '--json'],
        ]);
    });

    test('codegraph skips initialization when the workspace index exists', async () => {
        mkdirSync(join(TEST_DIR, '.codegraph'), { recursive: true });
        writeFileSync(join(TEST_DIR, 'codegraph'), '', 'utf8');
        const codegraph = useContainer().create(CapturingCodeGraphPlugin);

        await codegraph.observe({ goal: 'impact', kind: 'code_impact', symbol: 'Brain' }, { rootPath: TEST_DIR });

        expect(codegraph.commands).toEqual([
            ['impact', 'Brain', '--json'],
        ]);
    });
});

class MissingRtkPlugin extends RtkPlugin {
    protected override binaryPath(): string {
        return join(TEST_DIR, 'missing-rtk');
    }
}

class MissingCodeGraphPlugin extends CodeGraphPlugin {
    protected override binaryPath(): string {
        return join(TEST_DIR, 'missing-codegraph');
    }
}

class CapturingRtkPlugin extends RtkPlugin {
    public commands: string[][] = [];

    protected override binaryPath(): string {
        return join(TEST_DIR, 'rtk');
    }

    protected override async runCommand(_binary: string, args: string[]): Promise<{ timedOut: boolean; code: number; stdout: string; stderr: string }> {
        this.commands.push(args);
        return { timedOut: false, code: 0, stdout: 'compressed evidence', stderr: '' };
    }
}

class CapturingCodeGraphPlugin extends CodeGraphPlugin {
    public commands: string[][] = [];

    protected override binaryPath(): string {
        return join(TEST_DIR, 'codegraph');
    }

    protected override async runCommand(_binary: string, args: string[]): Promise<{ timedOut: boolean; code: number; stdout: string; stderr: string }> {
        this.commands.push(args);
        return { timedOut: false, code: 0, stdout: '{"ok":true}', stderr: '' };
    }
}
