import { describe, expect, test } from 'bun:test';
import { ChatRole } from '@/neural/brain/types';
import { Brain } from './brain';
import { SynapseSignalType, TurnPreempted } from '@/neural/types';

describe('Brain', () => {
    test('awaits coordinate handling at the Synapse boundary', async () => {
        let coordinated = false;
        const brain = new Brain({
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
        const brain = new Brain({
            emit: (type: string, data: unknown) => {
                emitted.push({ type: type as SynapseSignalType, data });
                return undefined;
            },
        });
        brain.scratchpad = { buildMessages: () => [{ role: ChatRole.System, content: 'system' }] } as never;
        brain.intelligence = {
            stream: async (messages: unknown, onChunk: (chunk: string) => void) => {
                seen.push(messages);
                onChunk('PONG1');
            },
        } as never;
        brain.workspace = { settle: async () => undefined, turn: () => ({ cwd: undefined }) } as never;

        await (brain as unknown as { reply: (chunk: string, turnId: string) => Promise<void> }).reply(
            '请只回复这五个字符：PONG1',
            'turn_1',
        );

        expect(seen[0]).toContainEqual({ role: ChatRole.User, content: '请只回复这五个字符：PONG1' });
        expect(emitted).toContainEqual({ type: SynapseSignalType.Reply, data: { turnId: 'turn_1', chunk: 'PONG1' } });
        expect(emitted).toContainEqual({ type: SynapseSignalType.Reply, data: { turnId: 'turn_1', chunk: null } });
    });

    test('passes the latest user message into research turns', async () => {
        const seen: unknown[] = [];
        const brain = new Brain({
            emit: () => undefined,
        } as never);
        brain.scratchpad = { buildMessages: () => [{ role: ChatRole.System, content: 'system' }] } as never;
        brain.investigation = {
            run: async (messages: unknown) => {
                seen.push(messages);
                return { answer: 'done', steps: 1, completed: true, paused: false, evidence: [] };
            },
        } as never;
        brain.workspace = { settle: async () => undefined, turn: () => ({ cwd: undefined }) } as never;

        await (brain as unknown as { research: (chunk: string, turnId: string) => Promise<void> }).research(
            '请读取 package.json',
            'turn_1',
        );

        expect(seen[0]).toContainEqual({ role: ChatRole.User, content: '请读取 package.json' });
    });

    test('runs thought-thread understanding silently from the assigned brief', async () => {
        const seen: Array<{ messages: unknown; options: unknown }> = [];
        const brain = new Brain({
            emit: () => undefined,
        } as never);
        brain.scratchpad = {
            ingestBrief: () => undefined,
            buildMessages: () => [{ role: ChatRole.System, content: 'thread base' }, { role: ChatRole.User, content: 'study this slice' }],
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
            constraints: [],
            refs: [],
            done: [],
            open: [],
            workspace: [],
        });

        expect(seen[0]?.messages).toContainEqual({ role: ChatRole.User, content: 'study this slice' });
        expect(seen[0]?.options).toEqual({ emitReply: false, cwd: undefined, signal: undefined });
    });

    test('passes the abort signal into settle and suppresses stale terminal output', async () => {
        const emitted: Array<{ type: SynapseSignalType; data: unknown }> = [];
        let preempted = false;
        const controller = new AbortController();
        const brain = new Brain({
            emit: (type: string, data: unknown) => {
                emitted.push({ type: type as SynapseSignalType, data });
                return undefined;
            },
            preempted: () => preempted,
        });
        brain.scratchpad = { buildMessages: () => [] } as never;
        brain.intelligence = {
            stream: async (_messages: unknown, onChunk: (chunk: string) => void) => onChunk('answer'),
        } as never;
        brain.workspace = {
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
