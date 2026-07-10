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

    test('limits identity writes to the fixed note allowlist', () => {
        const identity = useContainer().create(Identity, {
            name: 'flyflor',
            model: '',
            provider: '',
            contextLength: 0,
            maxTokens: 0,
        }, { emit: () => undefined });
        const values: Record<string, string> = { SOUL: 'soul', USER: 'user', EXTENSION: 'extension', AGENTS: 'rules' };
        identity.prompt = {
            data: Object.fromEntries(Object.keys(values).map((key) => [key, {
                data: values[key],
                set: (content: string) => { values[key] = content; },
            }])),
            section: (key: string) => values[key] ?? '',
        } as never;

        const result = identity.applyWrites([
            { file: 'SOUL.md', content: 'updated soul' },
            { file: 'AGENTS.md', content: 'unsafe rules' },
        ]);

        expect(result).toEqual({ written: ['SOUL.md'], rejected: ['AGENTS.md'] });
        expect(values.SOUL).toBe('updated soul');
        expect(values.AGENTS).toBe('rules');
        expect(identity.snapshot()).not.toContain('AGENTS.md');
    });
});
