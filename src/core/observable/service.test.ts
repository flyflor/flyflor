import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core/ioc';
import { Observable } from './service';

describe('Observable', () => {
    test('queues one circuit while independent circuits fire in parallel', async () => {
        const values: string[] = [];
        const first = useContainer().create(Observable<number>, 'first').pipe(async (value) => {
            await Promise.resolve();
            values.push(`first:${value}`);
            return value + 1;
        });
        const second = useContainer().create(Observable<number>, 'second').pipe(async (value) => {
            values.push(`second:${value}`);
            return value;
        });

        const outputs = await Promise.all([first.next(1), first.next(2), second.next(3)]);

        expect(outputs).toEqual([2, 3, 3]);
        expect(values.indexOf('first:1')).toBeLessThan(values.indexOf('first:2'));
    });

    test('awaits subscribers and fail-stops after an unregistered switch branch', async () => {
        const values: string[] = [];
        const circuit = useContainer().create(Observable<{ type: 'known' | 'missing'; value: string }>, 'switch')
            .switch<'known' | 'missing', string>((signal) => signal.type, {
                known: async (signal: { type: 'known' | 'missing'; value: string }) => signal.value,
            } as unknown as Record<'known' | 'missing', (signal: { type: 'known' | 'missing'; value: string }) => string | Promise<string>>)
            .subscribe(async (value) => { values.push(value); });

        expect(await circuit.next({ type: 'known', value: 'ok' })).toBe('ok');
        expect(values).toEqual(['ok']);
        await expect(circuit.next({ type: 'missing', value: 'no' })).rejects.toThrow('Observable branch is missing');
        await expect(circuit.next({ type: 'known', value: 'after failure' })).rejects.toThrow('Observable branch is missing');
        expect(values).toEqual(['ok']);
    });
});
