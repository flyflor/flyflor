import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigService } from '@/config';
import { FTool, useContainer } from '@/core';
import { Ask, Execute, Filesystem, Shell, Tools } from '@/tool';

async function component(): Promise<Tools> {
    return await useContainer().getAsync(Tools);
}

describe('Tools', () => {
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
    });

    afterEach(() => {
        ConfigService.path = originalConfigPath;
        process.chdir(originalProcessCwd);
        rmSync(root, { recursive: true, force: true });
        rmSync(other, { recursive: true, force: true });
    });

    test('lists class-owned tool definitions and keeps shell description free of semantic cwd', async () => {
        const tools = await component();
        const definitions = tools.list();

        expect(definitions.map((definition) => definition.name)).toEqual(['ask', 'filesystem', 'shell', 'execute', 'task']);
        expect(definitions.find((definition) => definition.name === 'filesystem')?.parameters.required).toEqual(['action', 'path']);
        expect(tools.list(false).find((definition) => definition.name === 'task')).toBeUndefined();
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

    test('tools inherit the executable tool base', async () => {
        const tools = await component();

        expect(tools.ask).toBeInstanceOf(FTool);
        expect(tools.filesystem).toBeInstanceOf(FTool);
        expect(tools.shell).toBeInstanceOf(FTool);
        expect(tools.execute).toBeInstanceOf(FTool);
        expect(tools.ask).toBeInstanceOf(Ask);
        expect(tools.filesystem).toBeInstanceOf(Filesystem);
        expect(tools.shell).toBeInstanceOf(Shell);
        expect(tools.execute).toBeInstanceOf(Execute);
    });

    test('dispatches Ask and Task with strict success results', async () => {
        const tools = await component();

        const ask = await tools.run({ id: 'ask_1', name: 'ask', arguments: { questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } });
        const task = await tools.run({ id: 'task_1', name: 'task', arguments: { tasks: [{ agent: 'worker', goal: 'inspect' }] } });

        expect(ask).toEqual({ name: 'ask', data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }, { label: 'other', description: '自定义回答，可引用上面的方案', custom: true }] }] }, effects: [{ type: 'ask' }] });
        expect(task).toEqual({ name: 'task', data: { tasks: [{ agent: 'worker', goal: 'inspect' }] }, effects: [{ type: 'task' }] });
    });

    test('projects direct action results through the result-owned Tool', async () => {
        const tools = await component();

        expect(tools.observe({
            name: 'filesystem',
            data: { action: 'read', path: '/tmp/file', content: 'private', bytes: 7, truncated: false },
            effects: [{ type: 'read', path: '/tmp/file' }],
        })).toBe('filesystem: action=read; path=/tmp/file; bytes=7; truncated=false');
        expect(tools.observe({
            name: 'shell',
            data: { action: 'shell', cwd: '/tmp', command: 'true', args: [], exitCode: 0, stdout: 'ok', stderr: '', timedOut: false },
        })).toContain('stdoutBytes=2');
        expect(tools.observe({
            name: 'execute',
            data: { action: 'execute', mode: 'serial', cwd: '/tmp', total: 2, success: 1, failed: 1, results: [] },
        })).toBe('execute: total=2; success=1; failed=1');
        expect(() => tools.observe({ name: 'task', data: { completes: [] } })).toThrow('does not own direct observations');
    });

    test('propagates invalid tool input unchanged', async () => {
        await expect((await component()).run({ id: 'ask_1', name: 'ask', arguments: {} })).rejects.toThrow('questions is required');
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
        expect(read).toMatchObject({ name: 'filesystem' });
        expect(read.data).toMatchObject({ action: 'read', path: resolve(target), content: 'safe' });
        rmSync(target, { force: true });
    });

    test('filesystem enforces UTF-8 byte limits without false CRLF truncation', async () => {
        writeFileSync(join(root, 'utf8.txt'), '界界', 'utf-8');
        writeFileSync(join(root, 'crlf.txt'), 'one\r\ntwo', 'utf-8');

        const utf8 = await (await component()).run({
            id: 'read_utf8',
            name: 'filesystem',
            arguments: { action: 'read', path: 'utf8.txt', limitBytes: 4 },
        });
        const crlf = await (await component()).run({
            id: 'read_crlf',
            name: 'filesystem',
            arguments: { action: 'read', path: 'crlf.txt', limitBytes: 100 },
        });

        expect(utf8.data).toMatchObject({ content: '界', bytes: 3, truncated: true });
        expect(crlf.data).toMatchObject({ content: 'one\ntwo', truncated: false });
    });

    test('filesystem rejects an explicit invalid cwd', async () => {
        await expect((await component()).run({
            id: 'read_bad_cwd',
            name: 'filesystem',
            arguments: { action: 'read', path: 'file.txt', cwd: 42 },
        })).rejects.toThrow('cwd is required');
    });

    test('filesystem rejects list and directory deletion', async () => {
        const tools = await component();
        mkdirSync(join(root, 'dir'), { recursive: true });

        await expect(tools.run({ id: 'list_1', name: 'filesystem', arguments: { action: 'list', path: '.' } })).rejects.toThrow('action must be read, write, edit, or delete');
        await expect(tools.run({ id: 'delete_1', name: 'filesystem', arguments: { action: 'delete', path: 'dir' } })).rejects.toThrow('delete only supports files');
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

        expect(result.name).toBe('shell');
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

        expect(result.name).toBe('shell');
        const data = result.data as { cwd: string; stdout: string };
        expect(data.cwd).toBe(other);
        expect(data.stdout).toBe(`${realpathSync(other)}\n`);
        expect(ConfigService.path.cwd).toBe(root);
    });

    test('shell resolves a relative cwd from the configured semantic root', async () => {
        mkdirSync(join(root, 'sub'), { recursive: true });
        const result = await (await component()).run({
            id: 'shell_relative',
            name: 'shell',
            arguments: {
                cwd: 'sub',
                command: process.execPath,
                args: ['-e', 'console.log(process.cwd())'],
            },
        });

        const data = result.data as { cwd: string; stdout: string };
        expect(data.cwd).toBe(resolve(root, 'sub'));
        expect(data.stdout).toBe(`${realpathSync(resolve(root, 'sub'))}\n`);
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

        expect(result.name).toBe('execute');
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

        expect(result.name).toBe('execute');
        expect(result.data).toMatchObject({ action: 'execute', mode: 'parallel', cwd: root, total: 2, success: 1, failed: 1 });
        const results = (result.data as { results: Array<{ id?: string; cwd: string; timedOut: boolean; ok: boolean; stdout: string }> }).results;
        expect(results.find((item) => item.id === 'slow')).toMatchObject({ cwd: root, timedOut: true, ok: false });
        const nested = results.find((item) => item.id === 'nested');
        expect(nested).toMatchObject({ cwd: resolve(root, 'sub'), timedOut: false, ok: true });
        expect(nested?.stdout).toBe(`nested:${realpathSync(nested!.cwd)}\n`);
    });

    test('execute propagates process spawn errors', async () => {
        await expect((await component()).run({
            id: 'execute_spawn',
            name: 'execute',
            arguments: {
                tasks: [{ runtime: 'python', path: 'missing.py', env: { PATH: '' } }],
            },
        })).rejects.toThrow();
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
