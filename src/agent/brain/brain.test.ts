import { describe, expect, test } from 'bun:test';
import { AgentChatRole } from '@/agent/types';
import { Brain } from './brain';
import { CallosumSignalType } from './callosum';
import { SynapseSignalType } from '@/neural/types';

describe('Brain', () => {
    test('awaits coordinate handling at the Synapse boundary', async () => {
        let coordinated = false;
        const brain = new Brain({ name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 }, {
            emit: () => undefined,
            coordinate: async () => {
                coordinated = true;
            },
        });

        await (brain as unknown as { handle: (signal: { type: CallosumSignalType; chunk: string }, turnId: string) => Promise<void> }).handle({
            type: CallosumSignalType.Coordinate,
            chunk: 'compare src/agent and src/neural',
        }, 'turn_1');

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

        await (brain as unknown as { reply: (signal: { type: CallosumSignalType; chunk: string }, turnId: string) => Promise<void> }).reply({
            type: CallosumSignalType.Reply,
            chunk: '请只回复这五个字符：PONG1',
        }, 'turn_1');

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
            run: async (_signal: unknown, messages: unknown) => {
                seen.push(messages);
                return { answer: 'done', steps: 1, completed: true, paused: false, evidence: [] };
            },
        } as never;
        brain.context = { settle: async () => undefined, turn: () => ({ cwd: undefined }) } as never;

        await (brain as unknown as { research: (signal: { type: CallosumSignalType; chunk: string }, turnId: string) => Promise<void> }).research({
            type: CallosumSignalType.Research,
            chunk: '请读取 package.json',
        }, 'turn_1');

        expect(seen[0]).toContainEqual({ role: AgentChatRole.User, content: '请读取 package.json' });
    });

    test('runs worker understanding silently from the assigned brief', async () => {
        const seen: Array<{ signal: unknown; options: unknown }> = [];
        const brain = new Brain({ name: 'worker', model: '', provider: '', contextLength: 0, maxTokens: 0 }, {
            emit: () => undefined,
        } as never);
        brain.memory = {
            ingestBrief: () => undefined,
            buildMessage: () => [{ role: AgentChatRole.System, content: 'worker base' }],
        } as never;
        brain.investigation = {
            run: async (signal: unknown, _messages: unknown, options: unknown) => {
                seen.push({ signal, options });
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
            recentSummaries: [],
        });

        expect(seen[0]?.signal).toEqual({ type: CallosumSignalType.Research, chunk: 'study this slice' });
        expect(seen[0]?.options).toEqual({ emitReply: false, cwd: undefined });
    });
});
