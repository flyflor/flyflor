import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { PromptService } from '@/prompt';
import { Memory } from './service';

describe('Memory', () => {
    test('keeps finite continuous notes without owning Turn state', () => {
        const memory = useContainer().create(Memory, {
            name: 'worker',
            model: 'model',
            provider: 'provider',
            maxTokens: 1,
            promptPackage: './prompts/agents/worker.md',
        }, { fire: async () => undefined });
        memory.prompt = useContainer().create(PromptService, 'prompts/memory') as PromptService;
        for (let index = 0; index < 18; index += 1) memory.remember(`note ${index}`, 'observation');

        expect(memory.snapshot()).toHaveLength(16);
        expect(memory.snapshot()[0]?.content).toBe('note 2');
        expect(JSON.stringify(memory.snapshot())).not.toContain('status');
        expect(memory.messages()[0]?.content).toContain('<agent_memory');
    });
});
