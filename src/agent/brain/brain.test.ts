import { describe, expect, test } from 'bun:test';
import { Brain } from './brain';
import { CallosumSignalType } from './callosum';
import { SynapseSignalType } from '@/neural/types';

describe('Brain', () => {
    test('forwards coordinate signals to Synapse without local handling', async () => {
        const emitted: Array<{ type: SynapseSignalType; data: unknown }> = [];
        const brain = new Brain({ name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 }, {
            emit: (type: string, data: unknown) => {
                emitted.push({ type: type as SynapseSignalType, data });
                return undefined;
            },
        });

        await (brain as unknown as { handle: (signal: { type: CallosumSignalType; chunk: string }) => Promise<void> }).handle({
            type: CallosumSignalType.Coordinate,
            chunk: 'compare src/agent and src/neural',
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0]?.type).toBe(SynapseSignalType.Coordinate);
    });
});
