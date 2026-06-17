import { describe, expect, test } from 'bun:test';
import { Observable, of } from './observable';

describe('Observable', () => {
    test('pushes values to subscribers', () => {
        const values: number[] = [];
        const observable = new Observable<number>();

        observable.subscribe((value) => values.push(value));
        observable.next(1);

        expect(values).toEqual([1]);
    });

    test('pipes values before subscribers receive them', () => {
        const values: number[] = [];
        const observable = new Observable<number>();

        observable.pipe((value) => value + 1).subscribe((value) => values.push(value));
        observable.next(1);

        expect(values).toEqual([2]);
    });

    test('stops the pipe when callback returns undefined', () => {
        const values: number[] = [];
        const observable = new Observable<number>();

        observable.pipe(() => undefined).subscribe((value) => values.push(value));
        observable.next(1);

        expect(values).toEqual([]);
    });

    test('pipes values into another observable', () => {
        const values: number[] = [];
        const source = new Observable<number>();
        const target = new Observable<number>();

        source.pipe(target);
        target.subscribe((value) => values.push(value));
        source.next(1);

        expect(values).toEqual([1]);
    });

    test('unsubscribes one subscriber or everything', () => {
        const values: number[] = [];
        const observable = new Observable<number>();
        const subscriber = (value: number) => values.push(value);

        observable.subscribe(subscriber);
        observable.unsubscribe(subscriber);
        observable.next(1);

        observable.pipe((value) => value + 1).subscribe(subscriber);
        observable.unsubscribe();
        observable.next(1);

        expect(values).toEqual([]);
    });

    test('emits of values after subscribe', () => {
        const values: number[] = [];

        of(1, 2).pipe((value) => value + 1).subscribe((value) => values.push(value));

        expect(values).toEqual([2, 3]);
    });

    test('filters values before subscribers receive them', () => {
        const values: number[] = [];

        of(1, 2, 3).filter((value) => value > 1).subscribe((value) => values.push(value));

        expect(values).toEqual([2, 3]);
    });

    test('filters values after pipe callbacks', () => {
        const values: number[] = [];

        of(1).pipe((value) => value + 1).filter((value) => value === 2).subscribe((value) => values.push(value));

        expect(values).toEqual([2]);
    });
});
