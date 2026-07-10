import { describe, expect, test } from 'bun:test';
import { FCortex, FTool } from './abstracts';

/** EN: Minimal executable test tool. ZH: 最小可执行测试工具。 */
class TestTool extends FTool<{ value: number }, { ok: true; data: { value: number } }> {
    /** EN: Increments the test value. ZH: 递增测试值。 */
    public override execute(input: { value: number }) {
        return { ok: true, data: { value: input.value + 1 } } as const;
    }
}

/** EN: Minimal cortex hierarchy test object. ZH: 最小皮层层级测试对象。 */
class TestCortex extends FCortex {}

describe('IOC abstracts', () => {
    test('keeps tools executable and cortex object-led', async () => {
        const tool = new TestTool();
        const cortex = new TestCortex();

        expect(await tool.execute({ value: 1 })).toEqual({ ok: true, data: { value: 2 } });
        expect(cortex).toBeInstanceOf(FCortex);
    });
});
