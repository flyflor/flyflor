import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Investigation } from './service';
import { AgentChatRole, type AgentChatMessage, type Intelligence } from '../intelligence';
import type { InvestigationObservation, ReadFilePlugin, RtkPlugin } from '@/plugins/tools';

describe('Investigation', () => {
    test('collects tool evidence and returns distilled investigation state', async () => {
        const investigation = await useContainer().getAsync(Investigation, {
            name: 'flyflor',
            model: 'test-model',
            provider: 'test-provider',
            contextLength: 1024,
            maxTokens: 64,
        });
        const seenMessages: AgentChatMessage[][] = [];
        const responses = [
            JSON.stringify({
                explicit_requests: ['inspect brain investigation'],
                implicit_goals: ['build agent understanding'],
                constraints: ['keep tools auxiliary'],
                unknowns: ['current brain shape'],
                hypotheses: [{
                    goal: 'add investigation before answering',
                    supporting_evidence: ['user asked for investigation layer'],
                    missing_evidence: ['brain implementation'],
                    confidence: 0.6,
                }],
                evidence: ['user emphasized understanding'],
                information_needed: ['read brain file'],
                next_question: '',
                confidence: 0.6,
                observe_requests: [{
                    goal: 'read brain file',
                    kind: 'file',
                    path: 'src/agent/brain/brain.ts',
                    pipes: ['rtk'],
                }],
            }),
            JSON.stringify({
                explicit_requests: ['inspect brain investigation'],
                implicit_goals: ['build agent understanding'],
                constraints: ['keep tools auxiliary'],
                unknowns: [],
                hypotheses: [{
                    goal: 'add investigation before answering',
                    supporting_evidence: ['user asked for investigation layer', 'brain owns transformer flow'],
                    missing_evidence: [],
                    confidence: 0.85,
                }],
                evidence: ['user emphasized understanding', 'read_file observed brain transformer'],
                information_needed: [],
                next_question: '',
                confidence: 0.85,
                observe_requests: [],
            }),
        ];
        investigation.intelligence = {
            complete: async (messages: AgentChatMessage[]) => {
                seenMessages.push(messages);
                return responses.shift() ?? '{}';
            },
        } as Intelligence;
        investigation.readFile = {
            definition: { name: 'read_file' },
            canObserve: () => true,
            observe: async () => ({
                ok: true,
                source: 'read_file',
                pipes: [],
                code: 'ok',
                summary: 'Read src/agent/brain/brain.ts',
                evidence: ['transformer'],
                data: { content: 'transformer' },
            }),
        } as unknown as ReadFilePlugin;
        investigation.rtk = {
            name: 'rtk',
            canPipe: () => true,
            pipeObservation: async (next: () => Promise<InvestigationObservation>) => {
                const observation = await next();
                return {
                    ...observation,
                    pipes: [...observation.pipes, 'rtk'],
                };
            },
        } as unknown as RtkPlugin;

        const result = await investigation.investigate({ content: '帮 brain 加调查', context: [] });

        expect(result.state.observe_requests).toBeUndefined();
        expect(result.state.confidence).toBe(0.85);
        expect(result.observations).toHaveLength(1);
        expect(result.observations[0]?.pipes).toEqual(['rtk']);
        expect(seenMessages).toHaveLength(2);
        expect(seenMessages[0]?.[0]?.role).toBe(AgentChatRole.System);
        expect(seenMessages[1]?.[1]?.content).toContain('Read src/agent/brain/brain.ts');
    });
});
