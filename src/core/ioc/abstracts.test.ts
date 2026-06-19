import { describe, expect, test } from 'bun:test';
import { Observable } from './abstracts';

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
});
