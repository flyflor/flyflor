import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from './agent';
import { AgentChatRole, type AgentChatMessage } from './brain/intelligence';
import { configureLogger, LoggerLevel } from '@/core/logger';
import { useContainer } from '@/core';
import type { BrainInvestigationResult } from './brain/investigation';

let tempPaths: string[] = [];

afterEach(() => {
    const container = useContainer();
    container.singletons.delete(Agent);
    configureLogger({
        consoleEnabled: true,
        path: './.logs/flyflor.log',
        colorEnabled: true,
        level: LoggerLevel.Debug,
        inspectDepth: 6,
    });
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('Agent runtime memory', () => {
    test('stores one turn while streaming chunks through the subject', async () => {
        const agent = await agentWithTempLogger();
        const messages: AgentChatMessage[] = [{ role: AgentChatRole.User, content: 'prepared hi' }];
        const investigation = defaultInvestigation();
        const committed: Array<{ user: string; assistant: string }> = [];
        Object.assign(agent.brain, {
            prepareTurn: async () => ({ investigation, messages }),
            streamTurn: async function* () {
                yield 'he';
                yield 'llo';
            },
            commitTurn: (user: string, assistant: string) => {
                committed.push({ user, assistant });
            },
        });
        const outputs: string[] = [];
        const subscription = agent.subscribe((content) => outputs.push(content));

        await agent.next('hi');
        subscription.unsubscribe();

        expect(outputs).toEqual(['he', 'llo']);
        expect(committed).toEqual([{ user: 'hi', assistant: 'hello' }]);
        expect(agent.memory.turns).toHaveLength(1);
        expect(agent.memory.turns[0]).toMatchObject({
            id: 1,
            status: 'completed',
            userMessage: 'hi',
            investigation,
            messages,
            chunks: ['he', 'llo'],
            assistant: 'hello',
        });
    });

    test('marks the current turn failed when streaming fails', async () => {
        const agent = await agentWithTempLogger();
        const messages: AgentChatMessage[] = [{ role: AgentChatRole.User, content: 'prepared hi' }];
        Object.assign(agent.brain, {
            prepareTurn: async () => ({ investigation: defaultInvestigation(), messages }),
            streamTurn: async function* () {
                yield 'partial';
                throw Error('stream failed');
            },
            commitTurn: () => {
                throw Error('commit should not run');
            },
        });

        await expect(agent.next('hi')).rejects.toThrow('stream failed');

        expect(agent.memory.turns).toHaveLength(1);
        expect(agent.memory.turns[0]).toMatchObject({
            status: 'failed',
            userMessage: 'hi',
            chunks: ['partial'],
            assistant: 'partial',
            error: 'stream failed',
        });
    });
});

async function agentWithTempLogger(): Promise<Agent> {
    const logPath = mkdtempSync(join(tmpdir(), 'flyflor-agent-'));
    tempPaths.push(logPath);
    configureLogger({
        consoleEnabled: false,
        path: join(logPath, 'agent.log'),
        colorEnabled: false,
        level: LoggerLevel.Debug,
    });
    return useContainer().getAsync(Agent, {
        name: 'flyflor',
        model: 'test-model',
        provider: 'test-provider',
        contextLength: 16,
        maxTokens: 8,
    });
}

function defaultInvestigation(): BrainInvestigationResult {
    return {
        state: {
            explicit_requests: ['hi'],
            implicit_goals: ['greeting'],
            constraints: [],
            unknowns: [],
            hypotheses: [{
                goal: 'greet the assistant',
                supporting_evidence: ['short greeting'],
                missing_evidence: [],
                confidence: 0.9,
            }],
            evidence: ['user said hi'],
            information_needed: [],
            next_question: '',
            confidence: 0.9,
        },
        observations: [],
    };
}
