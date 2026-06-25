import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FToolAtom, useContainer } from '@/core';
import { Ask, Confirm, Execute, Filesystem, ToolComponent } from '@/plugins';

async function component(): Promise<ToolComponent> {
    return await useContainer().getAsync(ToolComponent);
}

describe('ToolComponent', () => {
    let cwd: string;
    let root: string;

    beforeEach(() => {
        cwd = process.cwd();
        root = mkdtempSync(join(tmpdir(), 'flyflor-tools-'));
        process.chdir(root);
    });

    afterEach(() => {
        process.chdir(cwd);
        rmSync(root, { recursive: true, force: true });
    });

    test('lists tool definitions from prompt config', async () => {
        const definitions = await (await component()).list();

        expect(definitions.map((definition) => definition.name)).toEqual(['ask', 'confirm', 'filesystem', 'execute']);
        expect(definitions.find((definition) => definition.name === 'filesystem')?.parameters.required).toEqual(['action', 'cwd', 'path']);
        expect(definitions.find((definition) => definition.name === 'ask')?.description).toContain('Ask the user');
    });

    test('tool atoms inherit the atom base', async () => {
        const tools = await component();

        expect(tools.ask).toBeInstanceOf(FToolAtom);
        expect(tools.confirm).toBeInstanceOf(FToolAtom);
        expect(tools.filesystem).toBeInstanceOf(FToolAtom);
        expect(tools.execute).toBeInstanceOf(FToolAtom);
        expect(tools.ask).toBeInstanceOf(Ask);
        expect(tools.confirm).toBeInstanceOf(Confirm);
        expect(tools.filesystem).toBeInstanceOf(Filesystem);
        expect(tools.execute).toBeInstanceOf(Execute);
    });

    test('dispatches ask and confirm tools', async () => {
        const tools = await component();

        const ask = await tools.run({ id: 'ask_1', name: 'ask', arguments: { question: 'Pick?', options: [{ id: 'a' }] } });
        const confirm = await tools.run({ id: 'confirm_1', name: 'confirm', arguments: { question: 'Proceed?', recommended: true } });

        expect(ask).toEqual({ ok: true, name: 'ask', data: { kind: 'ask', question: 'Pick?', options: [{ id: 'a' }] } });
        expect(confirm).toEqual({ ok: true, name: 'confirm', data: { kind: 'confirm', question: 'Proceed?', recommended: true } });
    });

    test('wraps thrown tool errors', async () => {
        const result = await (await component()).run({ id: 'confirm_1', name: 'confirm', arguments: { question: 'Proceed?' } });

        expect(result.ok).toBe(false);
        expect(result.error?.message).toBe('recommended is required');
    });

    test('filesystem lists reads writes and edits from relative path + cwd', async () => {
        const tools = await component();

        await tools.run({ id: 'write_1', name: 'filesystem', arguments: { action: 'write', cwd: root, path: 'dir/file.txt', content: 'hello world' } });
        const list = await tools.run({ id: 'list_1', name: 'filesystem', arguments: { action: 'list', cwd: root, path: '.', depth: 2 } });
        const read = await tools.run({ id: 'read_1', name: 'filesystem', arguments: { action: 'read', cwd: root, path: 'dir/file.txt' } });
        const edit = await tools.run({ id: 'edit_1', name: 'filesystem', arguments: { action: 'edit', cwd: root, path: 'dir/file.txt', oldText: 'world', newText: 'flyflor' } });

        expect(list.data).toMatchObject({ action: 'list', path: root });
        expect((list.data as { entries: Array<{ path: string }> }).entries.map((entry) => entry.path)).toContain(resolve(root, 'dir/file.txt'));
        expect(read.data).toMatchObject({ action: 'read', path: resolve(root, 'dir/file.txt'), content: 'hello world', truncated: false });
        expect(edit.data).toMatchObject({ action: 'edit', path: resolve(root, 'dir/file.txt'), replacements: 1 });
    });

    test('filesystem accepts absolute paths outside cwd root restriction', async () => {
        const tools = await component();
        const target = join(tmpdir(), `flyflor-filesystem-${Date.now()}.txt`);
        writeFileSync(target, 'safe');

        const result = await tools.run({ id: 'read_1', name: 'filesystem', arguments: { action: 'read', cwd: root, path: target } });

        expect(result).toMatchObject({ ok: true, name: 'filesystem' });
        expect(result.data).toMatchObject({ action: 'read', path: resolve(target), content: 'safe' });
        rmSync(target, { force: true });
    });

    test('filesystem requires cwd for relative paths', async () => {
        const result = await (await component()).run({ id: 'read_1', name: 'filesystem', arguments: { action: 'read', path: 'dir/file.txt' } });

        expect(result.ok).toBe(false);
        expect(result.error?.message).toBe('cwd is required');
    });

    test('execute runs a local command and captures stdout and stderr', async () => {
        const result = await (await component()).run({
            id: 'execute_1',
            name: 'execute',
            arguments: {
                cwd: root,
                command: process.execPath,
                args: ['-e', 'console.log("ok"); console.error("warn")'],
            },
        });

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ action: 'execute', cwd: root, command: process.execPath, stdout: 'ok\n', stderr: 'warn\n', timedOut: false });
    });

    test('execute times out', async () => {
        const result = await (await component()).run({
            id: 'execute_1',
            name: 'execute',
            arguments: {
                cwd: root,
                command: process.execPath,
                args: ['-e', 'setTimeout(() => {}, 5000)'],
                timeoutMs: 1000,
            },
        });

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ action: 'execute', timedOut: true });
    });
});
