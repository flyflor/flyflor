import { describe, expect, test } from 'bun:test';
import { FCortex, FTool } from './abstracts';

/** ZH: 最小可执行测试工具。 EN: Minimal executable test tool. */
class TestTool extends FTool<{ value: number }, { value: number }> {
    /** ZH: 递增测试值。 EN: Increments the test value. */
    public override execute(input: { value: number }) {
        return { value: input.value + 1 };
    }
}

/** ZH: 最小皮层层级测试对象。 EN: Minimal cortex hierarchy test object. */
class TestCortex extends FCortex {}

describe('IOC abstracts', () => {
    test('keeps tools executable and cortex object-led', async () => {
        const tool = new TestTool();
        const cortex = new TestCortex();

        expect(await tool.execute({ value: 1 })).toEqual({ value: 2 });
        expect(cortex).toBeInstanceOf(FCortex);
    });
});
