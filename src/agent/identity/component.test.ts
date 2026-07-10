import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Identity } from './component';

describe('Identity', () => {
    test('renders a worker package without turn or tool state', async () => {
        const identity = await useContainer().getAsync(Identity, {
            name: 'worker',
            model: '',
            provider: '',
            contextLength: 0,
            maxTokens: 0,
            promptPackage: './prompts/agents',
            promptSections: ['worker'],
        }, { emit: () => undefined });

        const messages = identity.messages();

        expect(messages).toHaveLength(1);
        expect(messages[0]?.content).toContain('temporary work unit');
        expect(messages[0]?.content).not.toContain('tool_call_id');
        expect(messages[0]?.content).not.toContain('turn_');
    });
});
