import { describe, expect, test } from 'bun:test';
import { AgentChatRole, AgentSignal, type Assignment } from '@/agent/types';
import { Memory } from '@/agent/memory';
import { Turn } from '@/agent/turn';
import { useContainer } from '@/core';
import { Brain } from './brain';

const profile = { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 };

describe('Brain', () => {
    test('perceives once, includes completed memory, and completes a direct reply', async () => {
        const emitted: Array<{ type: string; data: unknown }> = [];
        const seen: unknown[] = [];
        const memory = useContainer().create(Memory);
        const previous = memory.begin('previous question', {
            mode: 'reply',
            goal: 'answer previous',
            constraints: [],
            references: [],
        });
        memory.complete(previous.id, 'previous answer');
        let perceptions = 0;
        const brain = useContainer().create(Brain, profile, {
            emit: (type: string, data: unknown) => emitted.push({ type, data }),
        });
        brain.memory = memory;
        brain.callosum = {
            perceive: async () => {
                perceptions += 1;
                return { mode: 'reply', goal: 'answer latest', constraints: [], references: [] } as const;
            },
        } as never;
        brain.identity = { messages: () => [{ role: AgentChatRole.System, content: 'identity' }] } as never;
        brain.model = {
            stream: async (messages: unknown, onChunk: (chunk: string) => void) => {
                seen.push(messages);
                onChunk('PONG1');
            },
        } as never;

        await brain.receive('latest question');

        expect(perceptions).toBe(1);
        expect(seen[0]).toEqual([
            { role: AgentChatRole.System, content: 'identity' },
            { role: AgentChatRole.User, content: 'previous question' },
            { role: AgentChatRole.Assistant, content: 'previous answer' },
            { role: AgentChatRole.User, content: 'latest question' },
        ]);
        expect(memory.snapshots().at(-1)).toMatchObject({ status: 'completed', answer: 'PONG1' });
        expect(emitted).toContainEqual({ type: AgentSignal.Reply, data: 'PONG1' });
    });

    test('awaits coordinate handling at the cortex boundary', async () => {
        const memory = useContainer().create(Memory);
        let coordinated = false;
        const brain = useContainer().create(Brain, profile, {
            emit: () => undefined,
            coordinate: async (value: unknown) => {
                coordinated = value instanceof Turn;
                memory.complete((value as Turn).id, 'coordinated');
            },
        });
        brain.memory = memory;
        brain.callosum = {
            perceive: async () => ({ mode: 'coordinate', goal: 'compare layers', constraints: [], references: [] }),
        } as never;

        await brain.receive('compare src/agent and src/neural');

        expect(coordinated).toBe(true);
        expect(memory.snapshots()[0]).toMatchObject({ status: 'completed', answer: 'coordinated' });
    });

    test('marks the active turn failed when cognition throws', async () => {
        const memory = useContainer().create(Memory);
        const brain = useContainer().create(Brain, profile, { emit: () => undefined });
        brain.memory = memory;
        brain.callosum = {
            perceive: async () => ({ mode: 'research', goal: 'inspect', constraints: [], references: [] }),
        } as never;
        brain.identity = { messages: () => [] } as never;
        brain.investigation = { run: async () => { throw Error('tool loop failed'); } } as never;

        await expect(brain.receive('inspect')).rejects.toThrow('tool loop failed');

        expect(memory.current()).toBeUndefined();
        expect(memory.snapshots()[0]).toMatchObject({ status: 'failed', error: 'tool loop failed' });
    });

    test('runs an isolated worker assignment without shared turn state', async () => {
        const seen: unknown[] = [];
        const brain = useContainer().create(Brain, { ...profile, name: 'worker' }, { emit: () => undefined });
        brain.identity = { messages: () => [{ role: AgentChatRole.System, content: 'worker identity' }] } as never;
        brain.investigation = {
            run: async (messages: unknown, options: unknown) => {
                seen.push({ messages, options });
                return { answer: 'worker answer', steps: 1, completed: true, paused: false, evidence: ['worker evidence'] };
            },
        } as never;
        const assignment: Assignment = {
            profile: 'worker',
            goal: 'study this slice',
            persona: 'evidence specialist',
            constraints: ['read only'],
            cwd: '/tmp/work',
            context: 'recent context',
        };

        const outcome = await brain.work(assignment);

        expect(outcome).toEqual({ answer: 'worker answer', evidence: ['worker evidence'] });
        expect(seen[0]).toMatchObject({ options: { emitReply: false, cwd: '/tmp/work' } });
        expect(JSON.stringify(seen[0])).toContain('evidence specialist');
    });
});
