import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useContainer } from '@/core';
import { AskTool, CodeGraphTool, ConfirmTool, ReadFileTool, ToolBoundary } from '@/plugins/tools';

function context() {
    return { callId: 'test', intent: 'test intent', evidenceCount: 0 };
}

describe('research tools', () => {
    test('ask returns a structured question with options and client other support', async () => {
        const tool = await useContainer().getAsync(AskTool);

        const result = await tool.execute({
            question: 'Which scope should research use?',
            options: [
                { id: 'local', label: 'Local only', description: 'Use local code evidence.', recommended: true },
            ],
        }, context());

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(result.data).toEqual({
            kind: 'ask',
            question: 'Which scope should research use?',
            options: [
                { id: 'local', label: 'Local only', description: 'Use local code evidence.', recommended: true },
            ],
            other: true,
        });
    });

    test('ask rejects multiple recommended options', async () => {
        const tool = await useContainer().getAsync(AskTool);

        await expect(tool.execute({
            question: 'Choose one',
            options: [
                { id: 'a', label: 'A', description: 'A', recommended: true },
                { id: 'b', label: 'B', description: 'B', recommended: true },
            ],
        }, context())).rejects.toThrow('Ask requires exactly one recommended option');
    });

    test('confirm returns only a yes/no confirmation shape', async () => {
        const tool = await useContainer().getAsync(ConfirmTool);

        const result = await tool.execute({ question: 'Proceed with local research?', recommended: true }, context());

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(result.data).toEqual({
            kind: 'confirm',
            question: 'Proceed with local research?',
            default: true,
            recommended: true,
        });
    });

    test('read_file reads allowed local files with a byte cap', async () => {
        const tool = await useContainer().getAsync(ReadFileTool);

        const result = await tool.execute({ path: 'package.json', maxBytes: 20 }, context());

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(result.data.path).toBe('package.json');
        expect(result.data.bytes).toBeGreaterThan(20);
        expect(result.data.content.length).toBeGreaterThan(0);
        expect(result.data.startLine).toBe(1);
        expect(result.data.endLine).toBeGreaterThanOrEqual(1);
        expect(result.data.totalLines).toBeGreaterThan(1);
        expect(result.data.truncated).toBe(true);
    });

    test('read_file returns a paged head by default and supports later line offsets', async () => {
        const tool = await useContainer().getAsync(ReadFileTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-read-file-pages-'));
        const source = join(root, 'notes.txt');
        writeFileSync(source, Array.from({ length: 240 }, (_, index) => `line-${index + 1}`).join('\n'), 'utf-8');

        const head = await tool.execute({ path: source }, {
            ...context(),
            workingDirectory: root,
        });
        const page = await tool.execute({ path: source, offsetLines: 200, limitLines: 20 }, {
            ...context(),
            workingDirectory: root,
        });

        expect(head.ok).toBe(true);
        expect(page.ok).toBe(true);
        if (!head.ok || !page.ok) throw Error('read_file failed');
        expect(head.data.startLine).toBe(1);
        expect(head.data.endLine).toBe(200);
        expect(head.data.totalLines).toBe(240);
        expect(head.data.truncated).toBe(true);
        expect(head.data.content).toContain('line-1');
        expect(head.data.content).not.toContain('line-201');
        expect(page.data.startLine).toBe(201);
        expect(page.data.endLine).toBe(220);
        expect(page.data.content).toContain('line-201');
    });

    test('read_file rejects paths outside research roots', async () => {
        const tool = await useContainer().getAsync(ReadFileTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-outside-'));
        const file = join(root, 'secret.txt');
        writeFileSync(file, 'secret', 'utf-8');

        await expect(tool.execute({ path: file }, context())).rejects.toThrow('Tool path is outside allowed research roots');
    });

    test('read_file resolves relative paths from the turn working directory', async () => {
        const tool = await useContainer().getAsync(ReadFileTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-workdir-'));
        const source = join(root, 'package.json');
        writeFileSync(source, '{"name":"workspace"}', 'utf-8');

        const result = await tool.execute({ path: 'package.json' }, {
            ...context(),
            workingDirectory: root,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(realpathSync(result.data.path)).toBe(realpathSync(source));
        expect(result.data.content).toBe('{"name":"workspace"}');
    });

    test('read_file accepts absolute paths inside the turn working directory', async () => {
        const tool = await useContainer().getAsync(ReadFileTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-absolute-workdir-'));
        mkdirSync(join(root, 'src'));
        const source = join(root, 'src', 'index.ts');
        writeFileSync(source, 'export const value = 1;', 'utf-8');

        const result = await tool.execute({ path: source }, {
            ...context(),
            workingDirectory: root,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(realpathSync(result.data.path)).toBe(realpathSync(source));
        expect(result.data.content).toBe('export const value = 1;');
    });

    test('read_file accepts absolute paths explicitly allowed for the turn', async () => {
        const tool = await useContainer().getAsync(ReadFileTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-explicit-root-'));
        const source = join(root, 'package.json');
        writeFileSync(source, '{"name":"explicit"}', 'utf-8');

        const result = await tool.execute({ path: source }, {
            ...context(),
            workingDirectory: '/path/that/does/not/exist',
            toolRoots: [root],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(realpathSync(result.data.path)).toBe(realpathSync(source));
        expect(result.data.content).toBe('{"name":"explicit"}');
    });

    test('read_file rejects absolute paths outside the turn working directory with root detail', async () => {
        const tool = await useContainer().getAsync(ReadFileTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-workdir-root-'));
        const outside = mkdtempSync(join(tmpdir(), 'flyflor-workdir-outside-'));
        const source = join(outside, 'secret.txt');
        writeFileSync(source, 'secret', 'utf-8');

        try {
            await tool.execute({ path: source }, {
                ...context(),
                workingDirectory: root,
            });
            throw Error('Expected read_file to reject outside path');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe('Tool path is outside allowed research roots');
            const detail = (error as { detail?: { roots?: string[]; workingDirectory?: string } }).detail;
            expect(detail?.workingDirectory).toBe(realpathSync(root));
            expect(detail?.roots).toContain(realpathSync(root));
        }
    });

    test('tool boundary describes resolved paths and allowed roots for debugging', async () => {
        const boundary = await useContainer().getAsync(ToolBoundary);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-boundary-'));
        const description = boundary.describe('package.json', {
            ...context(),
            workingDirectory: root,
        });

        expect(description.workingDirectory).toBe(realpathSync(root));
        expect(description.resolved).toBe(join(realpathSync(root), 'package.json'));
        expect(description.roots).toContain(realpathSync(root));
    });

    test('codegraph searches Flyflor and returns bounded matches', async () => {
        const tool = await useContainer().getAsync(CodeGraphTool);

        const result = await tool.execute({ query: 'CallosumSignalType', roots: ['src/agent'], maxResults: 5 }, context());

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(result.data.query).toBe('CallosumSignalType');
        expect(result.data.matches.length).toBeGreaterThan(0);
        expect(result.data.matches.length).toBeLessThanOrEqual(5);
    });

    test('codegraph searches the turn working directory by default when provided', async () => {
        const tool = await useContainer().getAsync(CodeGraphTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-codegraph-workdir-'));
        writeFileSync(join(root, 'target.ts'), 'const uniqueNeedle = true;', 'utf-8');

        const result = await tool.execute({ query: 'uniqueNeedle', maxResults: 5 }, {
            ...context(),
            workingDirectory: root,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(result.data.matches).toEqual([
            { path: realpathSync(join(root, 'target.ts')), line: 1, text: 'const uniqueNeedle = true;' },
        ]);
    });

    test('codegraph searches text files without language or extension whitelisting', async () => {
        const tool = await useContainer().getAsync(CodeGraphTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-codegraph-text-'));
        writeFileSync(join(root, 'BUILD.bazelish'), 'customLanguageNeedle()', 'utf-8');
        writeFileSync(join(root, 'NO_EXTENSION'), 'customLanguageNeedle without extension', 'utf-8');

        const result = await tool.execute({ query: 'customLanguageNeedle', maxResults: 5 }, {
            ...context(),
            workingDirectory: root,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(result.data.matches.map((match) => match.path).sort()).toEqual([
            realpathSync(join(root, 'BUILD.bazelish')),
            realpathSync(join(root, 'NO_EXTENSION')),
        ].sort());
    });

    test('codegraph skips binary-looking files and rejects broad queries', async () => {
        const tool = await useContainer().getAsync(CodeGraphTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-codegraph-binary-'));
        writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3, 4]));
        writeFileSync(join(root, 'source.weird'), 'binaryNeedle text', 'utf-8');

        await expect(tool.execute({ query: '.', maxResults: 5 }, {
            ...context(),
            workingDirectory: root,
        })).rejects.toThrow('Codegraph query is too broad');

        const result = await tool.execute({ query: 'binaryNeedle', maxResults: 5 }, {
            ...context(),
            workingDirectory: root,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(result.data.matches).toEqual([
            { path: realpathSync(join(root, 'source.weird')), line: 1, text: 'binaryNeedle text' },
        ]);
    });

    test('codegraph searches explicit turn roots by default', async () => {
        const tool = await useContainer().getAsync(CodeGraphTool);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-codegraph-explicit-root-'));
        writeFileSync(join(root, 'target.ts'), 'const explicitNeedle = true;', 'utf-8');

        const result = await tool.execute({ query: 'explicitNeedle', maxResults: 5 }, {
            ...context(),
            workingDirectory: '/path/that/does/not/exist',
            toolRoots: [root],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error);
        expect(result.data.matches).toEqual([
            { path: realpathSync(join(root, 'target.ts')), line: 1, text: 'const explicitNeedle = true;' },
        ]);
    });
});
