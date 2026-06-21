import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { useContainer } from '@/core';
import { FilesystemAction, Tools } from '@/plugins/tools';

async function registry(): Promise<Tools> {
    return await useContainer().getAsync(Tools);
}

describe('Tools', () => {
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

    test('lists tool definitions from decorator metadata', async () => {
        const definitions = (await registry()).list();

        expect(definitions.map((definition) => definition.name)).toEqual(['ask', 'confirm', 'filesystem']);
        expect(definitions.find((definition) => definition.name === 'filesystem')?.parameters.required).toEqual(['action', 'cwd', 'path']);
    });

    test('dispatches ask and confirm tools', async () => {
        const tools = await registry();

        const ask = await tools.run({ id: 'ask_1', name: 'ask', arguments: { question: 'Pick?', options: [{ id: 'a' }] } });
        const confirm = await tools.run({ id: 'confirm_1', name: 'confirm', arguments: { question: 'Proceed?', recommended: true } });

        expect(ask).toEqual({ ok: true, name: 'ask', data: { kind: 'ask', question: 'Pick?', options: [{ id: 'a' }] } });
        expect(confirm).toEqual({ ok: true, name: 'confirm', data: { kind: 'confirm', question: 'Proceed?', recommended: true } });
    });

    test('wraps thrown tool errors', async () => {
        const result = await (await registry()).run({ id: 'confirm_1', name: 'confirm', arguments: { question: 'Proceed?' } });

        expect(result.ok).toBe(false);
        expect(result.error?.message).toBe('recommended is required');
    });

    test('filesystem lists reads writes and edits from relative path + cwd', async () => {
        const tools = await registry();

        await tools.run({ id: 'write_1', name: 'filesystem', arguments: { action: FilesystemAction.Write, cwd: root, path: 'dir/file.txt', content: 'hello world' } });
        const list = await tools.run({ id: 'list_1', name: 'filesystem', arguments: { action: FilesystemAction.List, cwd: root, path: '.', depth: 2 } });
        const read = await tools.run({ id: 'read_1', name: 'filesystem', arguments: { action: FilesystemAction.Read, cwd: root, path: 'dir/file.txt' } });
        const edit = await tools.run({ id: 'edit_1', name: 'filesystem', arguments: { action: FilesystemAction.Edit, cwd: root, path: 'dir/file.txt', oldText: 'world', newText: 'flyflor' } });

        expect(list.data).toMatchObject({ action: FilesystemAction.List, path: root });
        expect((list.data as { entries: Array<{ path: string }> }).entries.map((entry) => entry.path)).toContain(resolve(root, 'dir/file.txt'));
        expect(read.data).toMatchObject({ action: FilesystemAction.Read, path: resolve(root, 'dir/file.txt'), content: 'hello world', truncated: false });
        expect(edit.data).toMatchObject({ action: FilesystemAction.Edit, path: resolve(root, 'dir/file.txt'), replacements: 1 });
    });

    test('filesystem accepts absolute paths outside cwd root restriction', async () => {
        const tools = await registry();
        const target = join(tmpdir(), `flyflor-filesystem-${Date.now()}.txt`);
        writeFileSync(target, 'safe');

        const result = await tools.run({ id: 'read_1', name: 'filesystem', arguments: { action: FilesystemAction.Read, cwd: root, path: target } });

        expect(result).toMatchObject({ ok: true, name: 'filesystem' });
        expect(result.data).toMatchObject({ action: FilesystemAction.Read, path: resolve(target), content: 'safe' });
        rmSync(target, { force: true });
    });

    test('filesystem requires cwd for relative paths', async () => {
        const result = await (await registry()).run({ id: 'read_1', name: 'filesystem', arguments: { action: FilesystemAction.Read, path: 'dir/file.txt' } });

        expect(result.ok).toBe(false);
        expect(result.error?.message).toBe('cwd is required');
    });
});
