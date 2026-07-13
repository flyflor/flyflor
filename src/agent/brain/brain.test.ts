import { describe, expect, test } from 'bun:test';
import { Context } from '@/agent/context';
import { Memory } from '@/agent/memory';
import { AgentChatRole, type AgentBus, type AgentTask, type NeuralSignal } from '@/agent/types';
import { Observable, useContainer } from '@/core';
import { PromptService } from '@/prompt';
import { Brain } from './brain';

const profile = {
    name: 'flyflor',
    model: 'model',
    provider: 'provider',
    contextLength: 1024,
    maxTokens: 256,
    promptPackage: '.config/agents/flyflor',
    promptSections: ['SOUL'],
};

/** EN: Builds one isolated Brain test object. ZH: 构造一个隔离的 Brain 测试对象。 */
function harness(name = 'flyflor') {
    const signals: NeuralSignal[] = [];
    const bus: AgentBus = {
        fire: async (signal) => {
            signals.push(signal);
            return undefined as never;
        },
    };
    const agentProfile = { ...profile, name };
    const brain = useContainer().create(Brain, agentProfile, bus);
    brain.circuit = useContainer().create(Observable<Parameters<Brain['receive']>[0]>, `brain-test:${name}`);
    brain.context = useContainer().create(Context);
    brain.memory = useContainer().create(Memory, agentProfile, bus);
    brain.memory.prompt = useContainer().create(PromptService, 'prompts/memory') as PromptService;
    brain.prompt = useContainer().create(PromptService, 'prompts/callosum') as never;
    brain.identity = { messages: () => [{ role: AgentChatRole.System, content: 'identity' }] } as never;
    brain.init();
    return { brain, signals };
}

describe('Brain', () => {
    test('perceives once, completes Context directly, and fires pure Complete', async () => {
        const { brain, signals } = harness();
        let perceptions = 0;
        let modelInput = '';
        brain.callosum = {
            perceive: async () => {
                perceptions += 1;
                return { intent: 'reply', goal: 'answer', constraints: [], references: [] };
            },
        } as never;
        brain.model = {
            stream: async (messages: unknown, next: (chunk: string) => void | Promise<void>) => {
                modelInput = JSON.stringify(messages);
                await next('PONG');
            },
        } as never;

        const complete = await brain.receive({ type: 'input', input: 'PING' });

        expect(perceptions).toBe(1);
        expect(complete.answer).toBe('PONG');
        expect(brain.context.recent()[0]).toMatchObject({ input: 'PING', answer: 'PONG' });
        expect(signals.map((signal) => signal.type)).toEqual(['reply', 'complete']);
        expect(modelInput.match(/PING/g)).toHaveLength(1);
        expect(JSON.stringify(brain.memory.snapshot())).not.toContain('PONG');
    });

    test('runs delegated work without creating or completing a Context Turn', async () => {
        const { brain, signals } = harness('worker');
        const context = {
            turnId: 'turn_1',
            input: 'root',
            goal: 'root goal',
            constraints: [],
            references: [],
            recent: [],
        };
        const task: AgentTask = { id: 'task_1', turnId: 'turn_1', agent: 'worker', goal: 'inspect', context };
        brain.investigation = {
            run: async () => ({ type: 'complete', id: task.id, turnId: task.turnId, agent: 'worker', answer: 'found', evidence: ['fact'] }),
        } as never;

        const complete = await brain.receive({ type: 'task', task });

        expect(complete.answer).toBe('found');
        expect(brain.context.recent()).toEqual([]);
        expect(brain.memory.snapshot().some((note) => note.content.includes('task=inspect'))).toBe(true);
        expect(signals).toEqual([]);
    });
});
