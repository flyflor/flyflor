import { describe, expect, test } from 'bun:test';
import { ConfigService, type FAgentProfileConfiguration, type FAgentActionScope } from '@/configuration';
import type { FAgentHost } from '@/core';
import { useContainer } from '@/core';
import type { AgentContext, AgentFocus } from '@/collective/context';
import { AgentChatRole } from '@/agent/types';
import type { ProviderMessage } from '@/inference';
import type { ActionObservation } from './action';
import type { InferenceResult } from '@/inference';
import { Brain } from './brain';

const profile: FAgentProfileConfiguration = {
    name: 'flyflor', role: 'leader', description: 'leader', capabilities: [], actionScope: 'full',
    model: 'model', provider: 'provider', contextLength: 1, maxTokens: 1,
};

const focus: AgentFocus = {
    id: 'focus_1', revision: 1, ownerSpeakerId: 'speaker', messages: [], goal: 'goal', constraints: [], references: [],
};

describe('Brain', () => {
    test('runs Thought to Action to Observation to Thought without exposing reasoning', async () => {
        const brain = useContainer().create(Brain, profile, { emit: () => undefined } satisfies FAgentHost);
        brain.config = { collective: { contextCharLimit: 32000 } } as ConfigService;
        const thoughts: InferenceResult[] = [
            { text: 'checking', reasoning: 'hidden chain', actionRequests: [{ id: 'read', name: 'filesystem', arguments: { action: 'read' } }], stopReason: 'toolUse' },
            { text: 'final answer', reasoning: 'more hidden chain', actionRequests: [], stopReason: 'stop' },
        ];
        const messagesSeen: unknown[] = [];
        brain.thought = {
            think: async (messages: unknown[], _tools: unknown[], onText: (chunk: string) => void) => {
                messagesSeen.push(structuredClone(messages));
                const result = thoughts.shift()!;
                onText(result.text);
                return result;
            },
        } as never;
        brain.action = {
            tools: { list: async (_scope: FAgentActionScope) => [] },
            run: async (): Promise<ActionObservation> => ({
                request: { id: 'read', name: 'filesystem', arguments: { action: 'read' } },
                result: { ok: true, name: 'filesystem', data: { content: 'provider-local raw result' } },
                evidence: 'filesystem ok: path=/tmp/a',
            }),
        } as never;
        const remembered: string[] = [];
        brain.memory = {
            messages: (_context: AgentContext) => [{ role: 'user', content: 'goal' }],
            remember: (content: string) => remembered.push(content),
            snapshot: () => [],
        } as never;
        const chunks: string[] = [];

        const report = await brain.run({ agentId: 'flyflor', focus, history: [], items: [], localMemory: [] }, {
            focusId: focus.id, revision: 1, signal: new AbortController().signal, stream: true, onChunk: (chunk) => chunks.push(chunk),
        });

        expect(messagesSeen).toHaveLength(2);
        expect(JSON.stringify(messagesSeen[1])).toContain('hidden chain');
        expect(JSON.stringify(messagesSeen[1])).toContain('provider-local raw result');
        expect(report.answer).toBe('checkingfinal answer');
        expect(report.evidence).toEqual(['filesystem ok: path=/tmp/a']);
        expect(JSON.stringify(report)).not.toContain('hidden chain');
        expect(remembered).toEqual(['filesystem ok: path=/tmp/a']);
        expect(chunks).toEqual(['checking', 'final answer']);
    });

    test('evicts old provider replay only as whole Thought/Action cycles', async () => {
        const brain = useContainer().create(Brain, profile, { emit: () => undefined } satisfies FAgentHost);
        brain.config = { collective: { contextCharLimit: 500 } } as ConfigService;
        const messagesSeen: ProviderMessage[][] = [];
        let thought = 0;
        brain.thought = {
            think: async (messages: ProviderMessage[]) => {
                messagesSeen.push(structuredClone(messages));
                thought += 1;
                if (thought === 3) return { text: 'done', reasoning: '', actionRequests: [], stopReason: 'stop' };
                return {
                    text: `cycle-${thought}`,
                    reasoning: `reasoning-${thought}`,
                    actionRequests: [{ id: `call-${thought}`, name: 'filesystem', arguments: { action: 'read' } }],
                    stopReason: 'toolUse',
                };
            },
        } as never;
        brain.action = {
            tools: { list: async () => [] },
            run: async (request: { id: string }): Promise<ActionObservation> => ({
                request: { id: request.id, name: 'filesystem', arguments: { action: 'read' } },
                result: { ok: true, name: 'filesystem', data: { content: request.id.repeat(3000) } },
                evidence: `evidence-${request.id}`,
            }),
        } as never;
        brain.memory = {
            messages: () => [{ role: AgentChatRole.User, content: 'goal' }],
            remember: () => undefined,
            snapshot: () => [],
        } as never;

        await brain.run({ agentId: 'flyflor', focus, history: [], items: [], localMemory: [] }, {
            focusId: focus.id, revision: 1, signal: new AbortController().signal, stream: false, onChunk: () => undefined,
        });

        const second = JSON.stringify(messagesSeen[1]);
        const third = JSON.stringify(messagesSeen[2]);
        expect(second).toContain('call-1');
        expect(second).toContain('tool result truncated for provider replay');
        expect(third).not.toContain('call-1');
        expect(third).toContain('call-2');
        expect(messagesSeen[2]?.filter((message) => message.role === 'action')).toHaveLength(1);
    });

    test('settles with partial progress instead of throwing when the thought step limit is exhausted', async () => {
        const brain = useContainer().create(Brain, profile, { emit: () => undefined } satisfies FAgentHost);
        brain.config = { collective: { contextCharLimit: 32000 } } as ConfigService;
        let thoughts = 0;
        brain.thought = {
            think: async (_messages: unknown[], _tools: unknown[], onText: (chunk: string) => void) => {
                thoughts += 1;
                const result = {
                    text: `step-${thoughts}`,
                    reasoning: '',
                    actionRequests: [{ id: `call-${thoughts}`, name: 'filesystem', arguments: { action: 'read' } }],
                    stopReason: 'toolUse',
                };
                onText(result.text);
                return result;
            },
        } as never;
        brain.action = {
            tools: { list: async () => [] },
            run: async (request: { id: string }): Promise<ActionObservation> => ({
                request: { id: request.id, name: 'filesystem', arguments: { action: 'read' } },
                result: { ok: true, name: 'filesystem', data: {} },
                evidence: `evidence-${request.id}`,
            }),
        } as never;
        brain.memory = {
            messages: () => [{ role: AgentChatRole.User, content: 'goal' }],
            remember: () => undefined,
            snapshot: () => [],
        } as never;

        const report = await brain.run({ agentId: 'flyflor', focus, history: [], items: [], localMemory: [] }, {
            focusId: focus.id, revision: 1, signal: new AbortController().signal, stream: false, onChunk: () => undefined,
        });

        expect(report.answer).toContain('step-1');
        expect(report.evidence).toHaveLength(24);
        expect(report.remaining).toEqual(['Thought step limit exceeded: flyflor']);
        expect(report.steps).toBe(24);
    });
});
