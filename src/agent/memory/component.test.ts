import { describe, expect, test } from 'bun:test';
import type { FAgentProfileConfiguration, ConfigService } from '@/configuration';
import type { FAgentHost } from '@/core';
import { useContainer } from '@/core';
import type { AgentContext } from '@/collective/context';
import { Memory } from './component';

const profile: FAgentProfileConfiguration = {
    name: 'researcher',
    role: 'specialist',
    description: 'research',
    capabilities: ['read'],
    actionScope: 'read',
    model: 'model',
    provider: 'provider',
    contextLength: 32000,
    maxTokens: 1000,
    promptPackage: './prompts/agents/researcher',
};

const host: FAgentHost = { emit: () => undefined };

const agentContext = (): AgentContext => ({
    agentId: 'researcher',
    focus: {
        id: 'focus_1', revision: 1, ownerSpeakerId: 'speaker-a',
        messages: [{ messageId: 'm1', speakerId: 'speaker-a', text: 'inspect' }],
        goal: 'inspect', constraints: [], references: [],
    },
    history: [],
    items: [],
    localMemory: [],
});

describe('Memory', () => {
    test('keeps only the highest-salience volatile notes within its cap', async () => {
        const memory = await useContainer().getAsync(Memory, profile, host);
        memory.config = { collective: { agentNoteLimit: 2 } } as ConfigService;

        memory.remember('low', 'observation', 0.1);
        memory.remember('high', 'reflection', 1);
        memory.remember('middle', 'observation', 0.5);

        expect(memory.snapshot().map((note) => note.content)).toEqual(['high', 'middle']);
    });

    test('constructs model input from the shared focus and supplied local notes', async () => {
        const memory = await useContainer().getAsync(Memory, profile, host);
        const context = agentContext();
        context.history.push({ focusId: 'focus_0', messages: [{ speakerId: 'speaker-a', text: 'earlier question' }], answer: 'earlier answer', agentId: 'flyflor', createdAt: 1 });
        context.localMemory.push({ id: 'note', content: 'local observation', source: 'observation', salience: 0.7, createdAt: 1, lastAccessedAt: 1 });

        const messages = memory.messages(context);
        const input = messages.at(-1)?.content ?? '';

        expect(messages[0]?.content).toContain('fixed evidence');
        expect(input).toContain('"messageId":"m1"');
        expect(input).toContain('earlier answer');
        expect(input).toContain('local observation');
    });

    test('bounds one volatile note', async () => {
        const memory = await useContainer().getAsync(Memory, profile, host);
        memory.remember('x'.repeat(5000), 'reflection', 1);

        expect(memory.snapshot()[0]?.content.length).toBe(4000);
        expect(memory.snapshot()[0]?.content.endsWith('...')).toBe(true);
    });
});
