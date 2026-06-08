import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { useContainer } from '@/core';
import { configureLogger, LoggerLevel } from '@/core/logger';
import { Agent } from './agent';

let tempPaths: string[] = [];

afterEach(() => {
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

describe('Agent', () => {
    test('streams Brain transformer output through its Subject', async () => {
        const agent = await testAgent();
        const outputs: string[] = [];
        agent.brain.transformer = async function* () {
            yield 'he';
            yield 'llo';
        };

        const subscription = agent.subscribe(content => outputs.push(content));
        const result = await agent.next('hi');
        subscription.unsubscribe();

        expect(result).toBeUndefined();
        expect(outputs).toEqual(['he', 'llo']);
        expect(agent.memory.turns[0]).toMatchObject({
            id: 1,
            status: 'completed',
            userMessage: 'hi',
            chunks: ['he', 'llo'],
            assistant: 'hello',
        });
    });

    test('marks the turn failed when Brain transformer throws', async () => {
        const agent = await testAgent();
        agent.brain.transformer = async function* () {
            yield 'partial';
            throw Error('failed');
        };

        await expect(agent.next('hi')).rejects.toThrow('failed');

        expect(agent.memory.turns[0]).toMatchObject({
            status: 'failed',
            chunks: ['partial'],
            assistant: 'partial',
            error: 'failed',
        });
    });
});

async function testAgent(): Promise<Agent> {
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
