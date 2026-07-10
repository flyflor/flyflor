import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Identity } from './component';

const bus = { fire: async () => undefined };

describe('Identity', () => {
    test('renders one Agent prompt package without Turn state', async () => {
        const identity = await useContainer().getAsync(Identity, {
            name: 'worker',
            model: 'model',
            provider: 'provider',
            contextLength: 1,
            maxTokens: 1,
            promptPackage: './prompts/agents',
            promptSections: ['worker'],
        }, bus);

        expect(identity.messages()[0]?.content).toContain('persistent independent person');
        expect(identity.messages()[0]?.content).not.toContain('turn_');
    });

    test('rejects an invalid package write before changing files', async () => {
        const identity = await useContainer().getAsync(Identity, {
            name: 'flyflor',
            model: 'model',
            provider: 'provider',
            contextLength: 1,
            maxTokens: 1,
            promptPackage: './.config/agents/flyflor',
            promptSections: ['SOUL', 'USER', 'EXTENSION'],
        }, bus);

        expect(identity.snapshot()).toContain('<prompt_package');
        expect(() => identity.applyWrites([{ file: 'AGENTS.md', content: 'unsafe' }])).toThrow('not writable');
        expect(() => identity.applyWrites([{ file: 'SOUL.md', content: '' }])).toThrow('content is empty');
        expect(() => identity.applyWrites([
            { file: 'SOUL.md', content: 'one' },
            { file: 'SOUL.md', content: 'two' },
        ])).toThrow('duplicated');
    });
});
