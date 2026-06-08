import { describe, expect, test } from 'bun:test';
import { useContainer, type FLogger } from '@/core';
import { Investigation } from './service';
import { AgentChatRole, type AgentChatMessage, type Intelligence } from '../intelligence';
import type { InvestigationObservation, ReadFilePlugin, RtkPlugin } from '@/plugins/tools';

type SeenLog = { level: keyof FLogger; props: unknown[] };

describe('Investigation', () => {
    test('collects tool evidence and returns distilled investigation state', async () => {
        const investigation = await useContainer().getAsync(Investigation, {
            name: 'flyflor',
            model: 'test-model',
            provider: 'test-provider',
            contextLength: 1024,
            maxTokens: 64,
        });
        const logs: SeenLog[] = [];
        setLog(investigation, logs);
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
                evidence: ['FULL SECRET TOOL BODY'],
                data: { content: 'FULL SECRET TOOL BODY' },
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
        expect(hasLog(logs, 'investigation.start')).toBe(true);
        expect(hasLog(logs, 'investigation.ask')).toBe(true);
        expect(hasLog(logs, 'investigation.llm_response')).toBe(true);
        expect(hasLog(logs, 'investigation.state')).toBe(true);
        expect(hasLog(logs, 'investigation.observe_request')).toBe(true);
        expect(hasLog(logs, 'investigation.observe_result')).toBe(true);
        expect(hasLog(logs, 'investigation.complete')).toBe(true);
        expect(JSON.stringify(logs)).not.toContain('FULL SECRET TOOL BODY');
    });

    test('logs parse failures while returning fallback state', async () => {
        const investigation = await useContainer().getAsync(Investigation, {
            name: 'flyflor',
            model: 'test-model',
            provider: 'test-provider',
            contextLength: 1024,
            maxTokens: 64,
        });
        const logs: SeenLog[] = [];
        const invalidResponse = `not-json ${'x'.repeat(300)}`;
        setLog(investigation, logs);
        investigation.intelligence = {
            complete: async () => invalidResponse,
        } as unknown as Intelligence;

        const result = await investigation.investigate({ content: 'hi', context: [] });

        expect(result.state.explicit_requests).toEqual(['hi']);
        expect(result.state.unknowns).toEqual(['investigation output was not valid JSON']);
        expect(result.observations).toHaveLength(0);
        expect(hasLog(logs, 'investigation.llm_response')).toBe(true);
        expect(logs.some((entry) => entry.level === 'warn' && entry.props[0] === 'investigation.parse_failed')).toBe(true);
        expect(JSON.stringify(logs)).toContain(invalidResponse);
    });
});

function setLog(investigation: Investigation, logs: SeenLog[]): void {
    Object.defineProperty(investigation, 'log', {
        configurable: true,
        value: {
            debug: (...props: unknown[]) => {
                logs.push({ level: 'debug', props });
            },
            info: (...props: unknown[]) => {
                logs.push({ level: 'info', props });
            },
            warn: (...props: unknown[]) => {
                logs.push({ level: 'warn', props });
            },
            error: (...props: unknown[]) => {
                logs.push({ level: 'error', props });
            },
        } satisfies FLogger,
    });
}

function hasLog(logs: SeenLog[], name: string): boolean {
    return logs.some((entry) => entry.props[0] === name);
}
