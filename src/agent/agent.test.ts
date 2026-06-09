import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { useContainer, type AgentSignal } from '@/core';
import { configureLogger, LoggerLevel } from '@/core/logger';
import { from, of, throwError } from 'rxjs';
import { Agent } from './agent';
import { AgentChatRole, type AgentMemory } from './brain/intelligence';

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
    test('streams the brain reflex through its Subject and commits the turn', async () => {
        const agent = await testAgent();
        const input: AgentMemory[] = [{ role: AgentChatRole.User, content: 'hi' }];
        agent.memory.messages = async () => input;
        const signals: AgentSignal[] = [{ type: 'delta', text: 'he' }, { type: 'delta', text: 'llo' }, { type: 'done' }];
        agent.brain.transform = () => from(signals);

        const outputs: string[] = [];
        const subscription = agent.subscribe(content => outputs.push(content));
        const result = await agent.next('hi');
        subscription.unsubscribe();

        expect(result).toBeUndefined();
        expect(outputs).toEqual(['he', 'llo']);
        expect(agent.memory.context).toEqual([
            { role: AgentChatRole.User, content: 'hi' },
            { role: AgentChatRole.Assistant, content: 'hello' },
        ]);
    });

    test('replies directly and commits when memory analyzes the turn', async () => {
        const agent = await testAgent();
        agent.memory.messages = async () => '记住了。';
        let streamed = false;
        agent.brain.transform = () => {
            streamed = true;
            return of<AgentSignal>({ type: 'done' });
        };

        const outputs: string[] = [];
        const subscription = agent.subscribe(content => outputs.push(content));
        await agent.next('以后你叫 FlyFlor');
        subscription.unsubscribe();

        expect(streamed).toBe(false);
        expect(outputs).toEqual(['记住了。']);
        expect(agent.memory.context).toEqual([
            { role: AgentChatRole.User, content: '以后你叫 FlyFlor' },
            { role: AgentChatRole.Assistant, content: '记住了。' },
        ]);
    });

    test('does not commit the turn when the brain reflex fails', async () => {
        const agent = await testAgent();
        agent.memory.messages = async () => [{ role: AgentChatRole.User, content: 'hi' }];
        agent.brain.transform = () => throwError(() => Error('failed'));

        await expect(agent.next('hi')).rejects.toThrow('failed');
        expect(agent.memory.context).toEqual([]);
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
