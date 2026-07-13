import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { PromptService } from '@/prompt';
import { Memory } from './component';

describe('Memory', () => {
    test('retains goal constraints and references without copying current input', () => {
        const memory = useContainer().create(Memory, {
            name: 'worker',
            model: 'model',
            provider: 'provider',
            contextLength: 2,
            maxTokens: 1,
        }, { fire: async () => undefined });
        memory.prompt = useContainer().create(PromptService, 'prompts/memory') as PromptService;

        memory.observe({
            turnId: 'turn_1',
            input: 'RAW_CURRENT_INPUT',
            goal: 'inspect behavior',
            constraints: ['preserve tools'],
            references: [{ type: 'path', value: 'src/model' }],
            recent: [],
        });

        const snapshot = JSON.stringify(memory.snapshot());
        expect(snapshot).toContain('goal=inspect behavior');
        expect(snapshot).toContain('path:src/model');
        expect(snapshot).not.toContain('RAW_CURRENT_INPUT');
    });

    test('keeps finite continuous notes without owning Turn state', () => {
        const memory = useContainer().create(Memory, {
            name: 'worker',
            model: 'model',
            provider: 'provider',
            contextLength: 1,
            maxTokens: 1,
        }, { fire: async () => undefined });
        memory.prompt = useContainer().create(PromptService, 'prompts/memory') as PromptService;
        for (let index = 0; index < 18; index += 1) memory.remember(`note ${index}`, 'observation');

        expect(memory.snapshot()).toHaveLength(16);
        expect(memory.snapshot()[0]?.content).toBe('note 2');
        expect(JSON.stringify(memory.snapshot())).not.toContain('status');
        expect(memory.messages()[0]?.content).toContain('<agent_memory');
    });
});
