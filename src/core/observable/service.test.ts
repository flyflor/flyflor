import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core/ioc';
import { Observable } from './service';

describe('Observable', () => {
    test('queues one circuit while independent circuits fire in parallel', async () => {
        const values: string[] = [];
        const first = useContainer().create(Observable<number, number>).pipe(async (value) => {
            await Promise.resolve();
            values.push(`first:${value}`);
            return value + 1;
        });
        const second = useContainer().create(Observable<number, number>).pipe(async (value) => {
            values.push(`second:${value}`);
            return value;
        });

        const outputs = await Promise.all([first.next(1), first.next(2), second.next(3)]);

        expect(outputs).toEqual([2, 3, 3]);
        expect(values.indexOf('first:1')).toBeLessThan(values.indexOf('first:2'));
    });

    test('awaits subscribers and fail-stops after an unregistered switch branch', async () => {
        const values: string[] = [];
        type Signal = { type: 'known'; value: string } | { type: 'missing'; value: string };
        const circuit = useContainer().create(Observable<Signal, string>)
            .switch('type', {
                known: async (signal: Extract<Signal, { type: 'known' }>) => signal.value,
            } as unknown as {
                known: (signal: Extract<Signal, { type: 'known' }>) => string;
                missing: (signal: Extract<Signal, { type: 'missing' }>) => string;
            })
            .subscribe(async (value) => { values.push(value); });

        expect(await circuit.next({ type: 'known', value: 'ok' })).toBe('ok');
        expect(values).toEqual(['ok']);
        await expect(circuit.next({ type: 'missing', value: 'no' })).rejects.toThrow('Observable branch is missing');
        await expect(circuit.next({ type: 'known', value: 'after failure' })).rejects.toThrow('Observable branch is missing');
        expect(values).toEqual(['ok']);
    });

    test('rejects a second Input-to-Output transform', () => {
        const circuit = useContainer().create(Observable<number, number>).pipe((value) => value + 1);

        expect(() => circuit.pipe((value) => value + 2)).toThrow('transform is already installed');
    });

    test('rejects emission before its sole transform is installed', async () => {
        const circuit = useContainer().create(Observable<number, string>);

        await expect(circuit.next(1)).rejects.toThrow('transform is missing');
    });
});
