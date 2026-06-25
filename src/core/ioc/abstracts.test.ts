import { describe, expect, test } from 'bun:test';
import { CortexSignalType, FCortex, FToolAtom, Observable } from './abstracts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Observable', () => {
    test('pipes sync values', async () => {
        const values: number[] = [];

        new Observable<number>(1)
            .pipe((value: number) => value + 1)
            .subscribe((value: number) => values.push(value));
        await tick();

        expect(values).toEqual([2]);
    });

    test('pipes promise values', async () => {
        const values: number[] = [];

        new Observable<number>(1)
            .pipe(async (value: number) => value + 1)
            .subscribe((value: number) => values.push(value));
        await tick();

        expect(values).toEqual([2]);
    });

    test('pipes into returned observables', async () => {
        const values: number[] = [];
        const target = new Observable<number>().subscribe((value: number) => values.push(value));

        new Observable<number>(1)
            .pipe(() => target)
            .subscribe(() => {});
        await tick();

        expect(values).toEqual([1]);
    });

    test('switch pipes matching branch', async () => {
        const values: number[] = [];

        new Observable<number>(1)
            .switch((value) => value > 0 ? 'plus' : 'minus', {
                plus: (value) => value + 1,
            })
            .subscribe((value: number) => values.push(value));
        await tick();

        expect(values).toEqual([2]);
    });

    test('switch branch can stop subscribers', async () => {
        const values: number[] = [];

        new Observable<number>(1)
            .switch(() => 'stop', {
                stop: () => undefined,
            })
            .subscribe((value: number) => values.push(value));
        await tick();

        expect(values).toEqual([]);
    });

    test('toPromise waits for done', async () => {
        const stream = new Observable<number>();
        const promise = stream.toPromise();

        stream.done(3);

        expect(await promise).toBe(3);
    });

    test('substream emits async iterable values', async () => {
        const values: number[] = [];

        new Observable<number>()
            .substream((async function* () {
                yield 1;
                yield 2;
            })())
            .subscribe((value: number) => values.push(value));
        await tick();

        expect(values).toEqual([1, 2]);
    });
});

/**
 * EN: TestTool class declaration.
 * ZH: TestTool class 声明。
 */
class TestTool extends FToolAtom<{ value: number }, { value: number }> {
    public override onPipe(input: { value: number }) {
        return { ok: true, data: { value: input.value + 1 } } as const;
    }
}

describe('FToolAtom', () => {
    test('execute returns onPipe result', async () => {
        const tool = new TestTool();

        const result = await tool.execute({ value: 1 });

        expect(result).toEqual({ ok: true, data: { value: 2 } });
    });
});

/**
 * EN: TestCortex class declaration.
 * ZH: TestCortex class 声明。
 */
class TestCortex extends FCortex {}

describe('FCortex', () => {
    test('emits plain signal', () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();

        cortex.on(CortexSignalType.Reply, (signal) => { values.push(signal.data); });
        cortex.emit(CortexSignalType.Reply, 'ok');

        expect(values).toEqual(['ok']);
    });

    test('emits observable substream', async () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();
        const stream = new Observable<string>();

        cortex.on(CortexSignalType.Reply, (signal) => { values.push(signal.data); });
        const done = cortex.emit(CortexSignalType.Reply, stream).toPromise();
        stream.next('a');
        stream.next('b');
        stream.done();
        await done;

        expect(values).toEqual(['a', 'b']);
    });

    test('emits async iterable substream', async () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();

        cortex.on(CortexSignalType.Reply, (signal) => { values.push(signal.data); });
        await cortex.emit(CortexSignalType.Reply, (async function* () {
            yield 'a';
            yield 'b';
        })()).toPromise();

        expect(values).toEqual(['a', 'b']);
    });

    test('off removes listener', () => {
        const values: unknown[] = [];
        const cortex = new TestCortex();
        const fn = (signal: { data: unknown }) => { values.push(signal.data); };

        cortex.on(CortexSignalType.Reply, fn);
        cortex.off(CortexSignalType.Reply, fn);
        cortex.emit(CortexSignalType.Reply, 'skip');

        expect(values).toEqual([]);
    });
});
