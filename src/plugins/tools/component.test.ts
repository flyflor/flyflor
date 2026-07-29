import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigService } from '@/configuration';
import { FToolAtom, useContainer } from '@/core';
import { Workspace } from '@/neural/workspace';
import { Ask, Execute, Filesystem, Shell, ToolComponent } from '@/plugins';

async function component(): Promise<ToolComponent> {
    return await useContainer().getAsync(ToolComponent);
}

describe('ToolComponent', () => {
    let originalProcessCwd: string;
    let originalConfigPath: typeof ConfigService.path;
    let root: string;
    let other: string;

    beforeEach(async () => {
        originalProcessCwd = process.cwd();
        originalConfigPath = { ...ConfigService.path };
        root = mkdtempSync(join(tmpdir(), 'flyflor-tools-root-'));
        other = mkdtempSync(join(tmpdir(), 'flyflor-tools-other-'));
        ConfigService.path = { ...ConfigService.path, cwd: root };
        process.chdir(other);
        const workspace = new Workspace();
        workspace.prompt = { section: () => 'system placeholder' } as never;
        workspace.intelligence = {
            completeText: async (messages: Array<{ role: string; content: string }>) => {
                const user = messages.find((m) => m.role === 'user')?.content ?? '';
                const match = /cwd=([^\s,"}]+)/.exec(user);
                return JSON.stringify({
                    intent: 'research',
                    goal: user,
                    cwd: match?.[1],
                    constraints: [],
                    refs: [],
                    done: [],
                    open: [],
                    investigate: true,
                });
            },
        } as never;
        await workspace.ingest({ text: `调查当前环境 cwd=${other}`, speakerId: 'test' });
    });

    afterEach(() => {
        ConfigService.path = originalConfigPath;
        process.chdir(originalProcessCwd);
        rmSync(root, { recursive: true, force: true });
        rmSync(other, { recursive: true, force: true });
    });

    test('lists tool definitions from prompt config and keeps shell description free of semantic cwd', async () => {
        const definitions = await (await component()).list();

        expect(definitions.map((definition) => definition.name)).toEqual(['ask', 'filesystem', 'shell', 'execute']);
        expect(definitions.find((definition) => definition.name === 'filesystem')?.parameters.required).toEqual(['action', 'path']);
        expect(definitions.find((definition) => definition.name === 'task')).toBeUndefined();
        expect(definitions.find((definition) => definition.name === 'ask')?.description).toContain('Ask the user');
        const shell = definitions.find((definition) => definition.name === 'shell');
        expect(shell?.description).toContain('platform=');
        expect(shell?.description).toContain('arch=');
        expect(shell?.description).toContain('shell executes one command directly');
        expect(shell?.description).not.toContain('cwd=');
        expect(shell?.description).not.toContain('configCwd=');
        expect(shell?.description).not.toContain('goal=');
        expect(shell?.description).not.toContain('intent=');
        expect(shell?.description).not.toContain('constraints=');
        expect(shell?.description).not.toContain(other);
        expect(shell?.description).not.toContain(root);
        expect(shell?.description).not.toContain('git, rg, cat, ls');
    });

    test('tool atoms inherit the atom base', async () => {
        const tools = await component();

        expect(tools.ask).toBeInstanceOf(FToolAtom);
        expect(tools.filesystem).toBeInstanceOf(FToolAtom);
        expect(tools.shell).toBeInstanceOf(FToolAtom);
        expect(tools.execute).toBeInstanceOf(FToolAtom);
        expect(tools.ask).toBeInstanceOf(Ask);
        expect(tools.filesystem).toBeInstanceOf(Filesystem);
        expect(tools.shell).toBeInstanceOf(Shell);
        expect(tools.execute).toBeInstanceOf(Execute);
    });

    test('dispatches ask and rejects unknown tool', async () => {
        const tools = await component();

        const ask = await tools.run({ id: 'ask_1', name: 'ask', arguments: { questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } });
        const unknown = await tools.run({ id: 'task_1', name: 'task', arguments: {} });

        expect(ask).toEqual({ ok: true, name: 'ask', data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }, { label: 'other', description: '自定义回答，可引用上面的方案', custom: true }] }] } });
        expect(unknown).toEqual({
            ok: false,
            name: 'task',
            error: { code: 'TOOL_ERROR', message: 'Unknown tool: task' },
        });
    });

    test('wraps thrown tool errors for invalid input', async () => {
        const result = await (await component()).run({ id: 'ask_1', name: 'ask', arguments: {} });

        expect(result.ok).toBe(false);
        expect(result.error?.message).toBe('questions is required');
    });

    test('filesystem reads writes edits and deletes using config cwd by default', async () => {
        const tools = await component();

        await tools.run({ id: 'write_1', name: 'filesystem', arguments: { action: 'write', path: 'dir/file.txt', content: 'hello world' } });
        const read = await tools.run({ id: 'read_1', name: 'filesystem', arguments: { action: 'read', path: 'dir/file.txt' } });
        const edit = await tools.run({ id: 'edit_1', name: 'filesystem', arguments: { action: 'edit', path: 'dir/file.txt', oldText: 'world', newText: 'flyflor' } });
        const remove = await tools.run({ id: 'delete_1', name: 'filesystem', arguments: { action: 'delete', path: 'dir/file.txt' } });

        expect(read.data).toMatchObject({ action: 'read', path: resolve(root, 'dir/file.txt'), content: 'hello world', truncated: false });
        expect(edit.data).toMatchObject({ action: 'edit', path: resolve(root, 'dir/file.txt'), replacements: 1 });
        expect(remove.data).toMatchObject({ action: 'delete', path: resolve(root, 'dir/file.txt') });
    });

    test('filesystem accepts explicit cwd and absolute paths', async () => {
        const tools = await component();
        const target = join(tmpdir(), `flyflor-filesystem-${Date.now()}.txt`);
        writeFileSync(target, 'safe');

        const write = await tools.run({ id: 'write_1', name: 'filesystem', arguments: { action: 'write', cwd: other, path: 'dir/file.txt', content: 'alt' } });
        const read = await tools.run({ id: 'read_1', name: 'filesystem', arguments: { action: 'read', path: target } });

        expect(write.data).toMatchObject({ action: 'write', path: resolve(other, 'dir/file.txt') });
        expect(read).toMatchObject({ ok: true, name: 'filesystem' });
        expect(read.data).toMatchObject({ action: 'read', path: resolve(target), content: 'safe' });
        rmSync(target, { force: true });
    });

    test('filesystem rejects list and directory deletion', async () => {
        const tools = await component();
        mkdirSync(join(root, 'dir'), { recursive: true });

        const list = await tools.run({ id: 'list_1', name: 'filesystem', arguments: { action: 'list', path: '.' } });
        const remove = await tools.run({ id: 'delete_1', name: 'filesystem', arguments: { action: 'delete', path: 'dir' } });

        expect(list.ok).toBe(false);
        expect(list.error?.message).toBe('action must be read, write, edit, or delete');
        expect(remove.ok).toBe(false);
        expect(remove.error?.message).toBe('delete only supports files');
    });

    test('shell executes a direct command with args from config cwd', async () => {
        const result = await (await component()).run({
            id: 'shell_1',
            name: 'shell',
            arguments: {
                command: process.execPath,
                args: ['-e', 'console.log(process.cwd())'],
            },
        });

        expect(result.ok).toBe(true);
        const data = result.data as { action: string; cwd: string; command: string; stdout: string; timedOut: boolean };
        expect(data).toMatchObject({ action: 'shell', command: process.execPath, timedOut: false });
        expect(data.stdout).toBe(`${realpathSync(data.cwd)}\n`);
    });

    test('shell accepts explicit cwd without changing config cwd', async () => {
        const result = await (await component()).run({
            id: 'shell_1',
            name: 'shell',
            arguments: {
                cwd: other,
                command: process.execPath,
                args: ['-e', 'console.log(process.cwd())'],
            },
        });

        expect(result.ok).toBe(true);
        const data = result.data as { cwd: string; stdout: string };
        expect(data.cwd).toBe(other);
        expect(data.stdout).toBe(`${realpathSync(other)}\n`);
        expect(ConfigService.path.cwd).toBe(root);
    });

    test('aborts a running shell process', async () => {
        const controller = new AbortController();
        const startedAt = Date.now();
        const running = (await component()).run({
            id: 'shell_abort',
            name: 'shell',
            arguments: {
                command: process.execPath,
                args: ['-e', 'setTimeout(() => {}, 10000)'],
                timeoutMs: 10000,
            },
        }, controller.signal);

        setTimeout(() => controller.abort(), 40);

        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        expect(Date.now() - startedAt).toBeLessThan(2000);
    });

    test('execute runs script batches from config cwd and keeps serial order', async () => {
        writeFileSync(join(root, 'one.sh'), 'printf "one:%s\\n" "$PWD"\n', 'utf-8');
        writeFileSync(join(root, 'two.sh'), 'printf "two:%s\\n" "$PWD"\n', 'utf-8');

        const result = await (await component()).run({
            id: 'execute_1',
            name: 'execute',
            arguments: {
                tasks: [
                    { id: 'one', runtime: 'sh', path: 'one.sh' },
                    { id: 'two', runtime: 'sh', path: 'two.sh' },
                ],
            },
        });

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ action: 'execute', mode: 'serial', cwd: root, total: 2, success: 2, failed: 0 });
        const results = (result.data as { results: Array<{ id?: string; stdout: string; cwd: string }> }).results;
        expect(results.map((item) => item.id)).toEqual(['one', 'two']);
        expect(results[0]?.stdout).toBe(`one:${realpathSync(results[0]!.cwd)}\n`);
        expect(results[1]?.stdout).toBe(`two:${realpathSync(results[1]!.cwd)}\n`);
    });

    test('execute supports parallel batches, task cwd overrides, and timeouts', async () => {
        mkdirSync(join(root, 'sub'), { recursive: true });
        writeFileSync(join(root, 'base.sh'), 'sleep 1\nprintf "base:%s\\n" "$PWD"\n', 'utf-8');
        writeFileSync(join(root, 'sub', 'nested.sh'), 'printf "nested:%s\\n" "$PWD"\n', 'utf-8');

        const result = await (await component()).run({
            id: 'execute_1',
            name: 'execute',
            arguments: {
                mode: 'parallel',
                maxConcurrency: 2,
                tasks: [
                    { id: 'slow', runtime: 'sh', path: 'base.sh', timeoutMs: 200 },
                    { id: 'nested', runtime: 'sh', path: 'nested.sh', cwd: 'sub' },
                ],
            },
        });

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ action: 'execute', mode: 'parallel', cwd: root, total: 2, success: 1, failed: 1 });
        const results = (result.data as { results: Array<{ id?: string; cwd: string; timedOut: boolean; ok: boolean; stdout: string }> }).results;
        expect(results.find((item) => item.id === 'slow')).toMatchObject({ cwd: root, timedOut: true, ok: false });
        const nested = results.find((item) => item.id === 'nested');
        expect(nested).toMatchObject({ cwd: resolve(root, 'sub'), timedOut: false, ok: true });
        expect(nested?.stdout).toBe(`nested:${realpathSync(nested!.cwd)}\n`);
    });

    test('aborts active execute tasks and does not start later serial tasks', async () => {
        writeFileSync(join(root, 'slow.sh'), 'sleep 10\n', 'utf-8');
        writeFileSync(join(root, 'later.sh'), 'printf "later" > later.txt\n', 'utf-8');
        const controller = new AbortController();
        const running = (await component()).run({
            id: 'execute_abort',
            name: 'execute',
            arguments: {
                mode: 'serial',
                tasks: [
                    { id: 'slow', runtime: 'sh', path: 'slow.sh', timeoutMs: 10000 },
                    { id: 'later', runtime: 'sh', path: 'later.sh' },
                ],
            },
        }, controller.signal);

        setTimeout(() => controller.abort(), 40);

        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        expect(() => readFileSync(join(root, 'later.txt'), 'utf-8')).toThrow();
    });

    test('filesystem and execute ignore process cwd changes when config cwd is fixed', async () => {
        writeFileSync(join(root, 'cwd.sh'), 'printf "%s\\n" "$PWD"\n', 'utf-8');
        process.chdir(other);
        await (await component()).run({ id: 'write_1', name: 'filesystem', arguments: { action: 'write', path: 'config.txt', content: 'ok' } });
        const read = await (await component()).run({ id: 'read_1', name: 'filesystem', arguments: { action: 'read', path: 'config.txt' } });
        const execute = await (await component()).run({
            id: 'execute_1',
            name: 'execute',
            arguments: { tasks: [{ runtime: 'sh', path: 'cwd.sh' }] },
        });

        expect(read.data).toMatchObject({ path: resolve(root, 'config.txt'), content: 'ok' });
        const task = (execute.data as { results: Array<{ stdout: string; cwd: string }> }).results[0];
        expect(task?.stdout).toBe(`${realpathSync(task!.cwd)}\n`);
        expect(readFileSync(join(root, 'config.txt'), 'utf-8')).toBe('ok');
    });

});
