import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { useContainer, type ToolContext } from '@/core';
import '@/tools/module';
import { ToolRegistry } from './service';

let tempPaths: string[] = [];

afterEach(() => {
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('ToolRegistry', () => {
    test('discovers the installed tools structurally in stable name order', async () => {
        const registry = await testRegistry();

        const names = (await registry.list()).map((tool) => tool.name);

        expect(names).toEqual(['ask', 'bash', 'confirm', 'delete', 'edit', 'glob', 'grep', 'read', 'write']);
    });

    test('renders read-only and terminal traits into the model-visible catalog', async () => {
        const registry = await testRegistry();

        const catalog = await registry.render();

        expect(catalog).toContain('- read (read-only): ');
        expect(catalog).toContain('- ask (read-only, terminal): ');
        expect(catalog).toContain('- write: ');
        expect(catalog).toContain('"required":["path","content"]');
    });

    test('parses a final JSON reply, tolerating fences and prose', async () => {
        const registry = await testRegistry();

        expect(registry.parse('{"type":"final","text":"done"}')).toEqual({ type: 'final', text: 'done' });
        expect(registry.parse('```json\n{"type":"final","text":"done"}\n```')).toEqual({ type: 'final', text: 'done' });
    });

    test('parses a tool JSON reply into typed calls', async () => {
        const registry = await testRegistry();

        const message = registry.parse('{"type":"tool","calls":[{"name":"read","input":{"path":"a.ts"}},{"name":"glob"}]}');

        expect(message).toEqual({
            type: 'tool',
            calls: [
                { name: 'read', input: { path: 'a.ts' } },
                { name: 'glob', input: {} },
            ],
        });
    });

    test('parses flyflor:tool control blocks, one call per block', async () => {
        const registry = await testRegistry();

        const message = registry.parse(
            'Investigating first.\n<flyflor:tool>\n{"name":"read","input":{"path":"a.ts"}}\n</flyflor:tool>\n<flyflor:tool>\n{"name":"grep","input":{"query":"x"}}\n</flyflor:tool>',
        );

        expect(message).toEqual({
            type: 'tool',
            calls: [
                { name: 'read', input: { path: 'a.ts' } },
                { name: 'grep', input: { query: 'x' } },
            ],
        });
    });

    test('treats plain prose as a natural final reply and malformed JSON as invalid', async () => {
        const registry = await testRegistry();

        expect(registry.parse('All checks passed, nothing else to do.')).toEqual({ type: 'final', text: 'All checks passed, nothing else to do.' });
        expect(registry.parse('{"type":"tool","calls":[{"name":""}]}').type).toBe('invalid');
        expect(registry.parse('{"type":"final","text":').type).toBe('invalid');
        expect(registry.parse('').type).toBe('invalid');
    });

    test('dispatches a read call and arms the read-before-write ledger', async () => {
        const registry = await testRegistry();
        const context = testContext();
        const path = join(context.cwd, 'sample.txt');
        writeFileSync(path, 'alpha\nbeta\n', 'utf8');

        const result = await registry.dispatch({ name: 'read', input: { path: 'sample.txt' } }, context);

        expect(result.ok).toBe(true);
        expect(result.result).toContain('1\talpha');
        expect(context.reads.get(path)).toBe('alpha\nbeta\n');
    });

    test('refuses write/edit on unread or stale files and allows them after a read', async () => {
        const registry = await testRegistry();
        const context = testContext();
        const path = join(context.cwd, 'sample.txt');
        writeFileSync(path, 'alpha\nbeta\n', 'utf8');

        const unread = await registry.dispatch({ name: 'edit', input: { path, oldText: 'alpha', newText: 'gamma' } }, context);
        expect(unread.ok).toBe(false);
        expect(unread.result).toContain('not read this turn');

        await registry.dispatch({ name: 'read', input: { path } }, context);
        writeFileSync(path, 'alpha\nbeta\nchanged\n', 'utf8');
        const stale = await registry.dispatch({ name: 'edit', input: { path, oldText: 'alpha', newText: 'gamma' } }, context);
        expect(stale.ok).toBe(false);
        expect(stale.result).toContain('changed on disk');

        await registry.dispatch({ name: 'read', input: { path } }, context);
        const fresh = await registry.dispatch({ name: 'edit', input: { path, oldText: 'alpha', newText: 'gamma' } }, context);
        expect(fresh.ok).toBe(true);
        expect(readFileSync(path, 'utf8')).toBe('gamma\nbeta\nchanged\n');
    });

    test('returns unknown tools and executor failures as in-band error results', async () => {
        const registry = await testRegistry();
        const context = testContext();

        const unknown = await registry.dispatch({ name: 'teleport', input: {} }, context);
        expect(unknown.ok).toBe(false);
        expect(unknown.result).toContain("Unknown tool 'teleport'");
        expect(unknown.result).toContain('read');

        const failed = await registry.dispatch({ name: 'read', input: { path: 'missing.txt' } }, context);
        expect(failed.ok).toBe(false);
        expect(failed.result.length).toBeGreaterThan(0);
    });

    test('truncates oversized results at record time, keeping head and tail', async () => {
        const registry = await testRegistry();

        const clipped = registry.truncate('a'.repeat(50) + 'MIDDLE' + 'b'.repeat(50), 40);

        expect(clipped).toContain('[clipped');
        expect(clipped.startsWith('a'.repeat(20))).toBe(true);
        expect(clipped.endsWith('b'.repeat(20))).toBe(true);
        expect(clipped).not.toContain('MIDDLE');
    });
});

async function testRegistry(): Promise<ToolRegistry> {
    return useContainer().getAsync(ToolRegistry);
}

function testContext(): ToolContext {
    const cwd = mkdtempSync(join(tmpdir(), 'flyflor-tools-'));
    tempPaths.push(cwd);
    return { cwd, reads: new Map() };
}
