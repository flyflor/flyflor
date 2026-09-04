import { describe, expect, test } from 'bun:test';
import { FAgent, FCortex, FToolAtom } from './abstracts';
import type { ToolResult } from '@/core';

/**
 * EN: TestTool class declaration.
 * ZH: TestTool class 声明。
 */
class TestTool extends FToolAtom<{ value: number }, { value: number }> {
    public override onPipe(input: { value: number }): ToolResult<{ value: number }> {
        return { ok: true, data: { value: input.value + 1 } };
    }
}

describe('FToolAtom', () => {
    test('execute returns onPipe result', async () => {
        const tool = new TestTool();

        const result = await tool.execute({ value: 1 });

        expect(result).toEqual({ ok: true, data: { value: 2 } });
    });

    test('key derives the protocol key from the atom class name', () => {
        expect(new TestTool().key()).toBe('testTool');
    });
});

describe('FAgent', () => {
    test('binds one agent config and its collective host', () => {
        const config = { name: 'flyflor' } as never;
        const host = { emit: () => undefined };

        const atom = new (class extends FAgent {})(config, host);

        expect(atom.agentConfig).toBe(config);
        expect(atom.host).toBe(host);
    });
});

/**
 * EN: TestCortex class declaration.
 * ZH: TestCortex class 声明。
 */
class TestCortex extends FCortex {}

describe('FCortex', () => {
    test('emits one plain signal to its listeners (a cortical discharge)', () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();

        cortex.on('reply', (signal) => { values.push(signal.data); });
        cortex.emit('reply', 'ok');

        expect(values).toEqual(['ok']);
    });

    test('off removes one listener and clear removes all', () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();
        const fn = (signal: { data: unknown }) => { values.push(signal.data); };

        cortex.on('reply', fn);
        cortex.off('reply', fn);
        cortex.emit('reply', 'skip');
        cortex.on('reply', fn);
        cortex.on('event', fn);
        cortex.clear();
        cortex.emit('reply', 'skip');
        cortex.emit('event', 'skip');

        expect(values).toEqual([]);
    });

    test('listeners of one type never receive another type', () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();

        cortex.on('reply', (signal) => { values.push(signal.data); });
        cortex.emit('event', 'other');

        expect(values).toEqual([]);
    });
});
