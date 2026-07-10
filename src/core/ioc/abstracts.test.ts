import { describe, expect, test } from 'bun:test';
import { FCortex, FTool, type CortexSignal } from './abstracts';

class TestTool extends FTool<{ value: number }, { value: number }> {
    public override execute(input: { value: number }) {
        return { ok: true, data: { value: input.value + 1 } } as const;
    }
}

describe('FTool', () => {
    test('executes through an explicit async-compatible method', async () => {
        const tool = new TestTool();

        const result = await tool.execute({ value: 1 });

        expect(result).toEqual({ ok: true, data: { value: 2 } });
    });
});

type TestSignal = CortexSignal<'reply', unknown>;

class TestCortex extends FCortex<TestSignal> {}

describe('FCortex', () => {
    test('emits a direct signal', () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();

        cortex.on('reply', (signal) => { values.push(signal.data); });
        cortex.emit('reply', 'ok');

        expect(values).toEqual(['ok']);
    });

    test('off removes a listener', () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();
        const listener = (signal: { data: unknown }) => { values.push(signal.data); };

        cortex.on('reply', listener);
        cortex.off('reply', listener);
        cortex.emit('reply', 'skip');

        expect(values).toEqual([]);
    });
});
