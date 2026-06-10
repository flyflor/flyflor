import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import '@/plugins/tools';
import { ROOT_PATH } from '@/config';
import { EnvironmentService, ToolExecutor, type ToolContext } from '@/core';
import { useContainer } from '@/core/ioc';

const TEST_DIR = join(ROOT_PATH, '.tmp-core-tools');

afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('core execution tools', () => {
    test('write, read, edit, and delete operate inside the workspace', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        const executor = await useContainer().getAsync(ToolExecutor);
        const context = toolContext();
        const path = '.tmp-core-tools/file.txt';

        const write = await executor.execute({ id: '1', name: 'write', input: { path, content: 'hello world' } }, context);
        const read = await executor.execute({ id: '2', name: 'read', input: { path } }, context);
        const edit = await executor.execute({ id: '3', name: 'edit', input: { path, oldText: 'world', newText: 'flyflor', expectedReplacements: 1 } }, context);
        const edited = readFileSync(join(TEST_DIR, 'file.txt'), 'utf8');
        const deleted = await executor.execute({ id: '4', name: 'delete', input: { path } }, context);

        expect(write.ok).toBe(true);
        expect(read.output).toContain('hello world');
        expect(edit.ok).toBe(true);
        expect(edited).toBe('hello flyflor');
        expect(deleted.ok).toBe(true);
    });

    test('bash executes a platform-aware command', async () => {
        const executor = await useContainer().getAsync(ToolExecutor);
        const context = toolContext();
        const command = context.environment.os === 'windows' ? 'echo flyflor' : 'printf flyflor';

        const result = await executor.execute({ id: '1', name: 'bash', input: { command, timeoutMs: 5000 } }, context);

        expect(result.ok).toBe(true);
        expect(JSON.stringify(result.data)).toContain('flyflor');
    });

    test('grep and glob return bounded workspace evidence', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'a.ts'), 'export const Signal = "flyflor";\n', 'utf8');
        const executor = await useContainer().getAsync(ToolExecutor);
        const context = toolContext();

        const files = await executor.execute({ id: '1', name: 'glob', input: { pattern: '.tmp-core-tools/*.ts' } }, context);
        const matches = await executor.execute({ id: '2', name: 'grep', input: { query: 'Signal', include: '.tmp-core-tools/*.ts' } }, context);

        expect(files.output).toContain('a.ts');
        expect(matches.output).toContain('Signal');
    });
});

function toolContext(): ToolContext {
    const environment = useContainer().get(EnvironmentService);
    return {
        rootPath: ROOT_PATH,
        environment: environment.summary(ROOT_PATH),
    };
}
