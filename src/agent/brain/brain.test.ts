import { describe, expect, test } from 'bun:test';
import { AgentChatRole } from '@/agent/types';
import { Brain } from './brain';
import { SynapseSignalType, TurnPreempted } from '@/neural/types';

describe('Brain', () => {
    test('awaits coordinate handling at the Synapse boundary', async () => {
        let coordinated = false;
        const brain = new Brain({ name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 }, {
            emit: () => undefined,
            coordinate: async () => {
                coordinated = true;
            },
        });

        await (brain as unknown as { handle: (intent: string, chunk: string, turnId: string) => Promise<void> }).handle(
            'coordinate',
            'compare src/agent and src/neural',
            'turn_1',
        );

        expect(coordinated).toBe(true);
    });

    test('passes the latest user message into direct replies', async () => {
        const emitted: Array<{ type: SynapseSignalType; data: unknown }> = [];
        const seen: unknown[] = [];
        const brain = new Brain({ name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 }, {
            emit: (type: string, data: unknown) => {
                emitted.push({ type: type as SynapseSignalType, data });
                return undefined;
            },
        });
        brain.memory = { buildMessage: () => [{ role: AgentChatRole.System, content: 'system' }] } as never;
        brain.intelligence = {
            stream: async (messages: unknown, onChunk: (chunk: string) => void) => {
                seen.push(messages);
                onChunk('PONG1');
            },
        } as never;
        brain.context = { settle: async () => undefined, turn: () => ({ cwd: undefined }) } as never;

        await (brain as unknown as { reply: (chunk: string, turnId: string) => Promise<void> }).reply(
            '请只回复这五个字符：PONG1',
            'turn_1',
        );

        expect(seen[0]).toContainEqual({ role: AgentChatRole.User, content: '请只回复这五个字符：PONG1' });
        expect(emitted).toContainEqual({ type: SynapseSignalType.Reply, data: { turnId: 'turn_1', chunk: 'PONG1' } });
        expect(emitted).toContainEqual({ type: SynapseSignalType.Reply, data: { turnId: 'turn_1', chunk: null } });
    });

    test('passes the latest user message into research turns', async () => {
        const seen: unknown[] = [];
        const brain = new Brain({ name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 }, {
            emit: () => undefined,
        } as never);
        brain.memory = { buildMessage: () => [{ role: AgentChatRole.System, content: 'system' }] } as never;
        brain.investigation = {
            run: async (messages: unknown) => {
                seen.push(messages);
                return { answer: 'done', steps: 1, completed: true, paused: false, evidence: [] };
            },
        } as never;
        brain.context = { settle: async () => undefined, turn: () => ({ cwd: undefined }) } as never;

        await (brain as unknown as { research: (chunk: string, turnId: string) => Promise<void> }).research(
            '请读取 package.json',
            'turn_1',
        );

        expect(seen[0]).toContainEqual({ role: AgentChatRole.User, content: '请读取 package.json' });
    });

    test('runs worker understanding silently from the assigned brief', async () => {
        const seen: Array<{ messages: unknown; options: unknown }> = [];
        const brain = new Brain({ name: 'worker', model: '', provider: '', contextLength: 0, maxTokens: 0 }, {
            emit: () => undefined,
        } as never);
        brain.memory = {
            ingestBrief: () => undefined,
            buildMessage: () => [{ role: AgentChatRole.System, content: 'worker base' }, { role: AgentChatRole.User, content: 'study this slice' }],
        } as never;
        brain.investigation = {
            run: async (messages: unknown, options: unknown) => {
                seen.push({ messages, options });
                return { answer: 'done', steps: 1, completed: true, paused: false, evidence: [] };
            },
        } as never;

        await brain.understand({
            turnId: 'turn_1',
            intent: 'research',
            goal: 'study this slice',
            persona: 'temporary specialist',
            constraints: [],
            refs: [],
            done: [],
            open: [],
            workspace: [],
        });

        expect(seen[0]?.messages).toContainEqual({ role: AgentChatRole.User, content: 'study this slice' });
        expect(seen[0]?.options).toEqual({ emitReply: false, cwd: undefined, signal: undefined });
    });

    test('passes the abort signal into settle and suppresses stale terminal output', async () => {
        const emitted: Array<{ type: SynapseSignalType; data: unknown }> = [];
        let preempted = false;
        const controller = new AbortController();
        const brain = new Brain({ name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 }, {
            emit: (type: string, data: unknown) => {
                emitted.push({ type: type as SynapseSignalType, data });
                return undefined;
            },
            preempted: () => preempted,
        });
        brain.memory = { buildMessage: () => [] } as never;
        brain.intelligence = {
            stream: async (_messages: unknown, onChunk: (chunk: string) => void) => onChunk('answer'),
        } as never;
        brain.context = {
            settle: async (_turnId: string, _input: unknown, signal?: AbortSignal) => {
                expect(signal).toBe(controller.signal);
                preempted = true;
                controller.abort();
                return undefined;
            },
            turn: () => ({ status: 'working' }),
            interrupt: async () => undefined,
        } as never;

        await expect((brain as unknown as { reply: (chunk: string, turnId: string, abortSignal: AbortSignal) => Promise<void> }).reply(
            'reply',
            'turn_1',
            controller.signal,
        )).rejects.toBeInstanceOf(TurnPreempted);

        expect(emitted).not.toContainEqual({ type: SynapseSignalType.Reply, data: { turnId: 'turn_1', chunk: null } });
    });
});
