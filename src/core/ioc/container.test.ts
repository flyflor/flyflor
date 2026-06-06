import { afterEach, describe, expect, test } from 'bun:test';
import { Agent } from '@/agent';
import { Brain } from '@/agent/brain';
import { Inject, useContainer } from '@/core';
import { configureLogger, LoggerLevel } from '@/core/logger';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempPaths: string[] = [];

afterEach(() => {
    const container = useContainer();
    container.singletons.delete(Agent);
    container.singletons.delete(Brain);
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

describe('Container property injection', () => {
    test('uses sync @Inject callback results as constructor arguments', async () => {
        class SyncDependency {
            constructor(public readonly value: string) {}
        }

        class SyncHost {
            public readonly value = 'sync-value';

            @Inject(function (this: SyncHost) {
                return this.value;
            })
            public dependency!: SyncDependency;
        }

        const host = await useContainer().getAsync(SyncHost);

        expect(host.dependency).toBeInstanceOf(SyncDependency);
        expect(host.dependency.value).toBe('sync-value');
    });

    test('uses async @Inject callback results as constructor arguments', async () => {
        class AsyncDependency {
            constructor(
                public readonly name: string,
                public readonly count: number,
            ) {}
        }

        class AsyncHost {
            public readonly name = 'async-value';

            @Inject(async function (this: AsyncHost) {
                return [this.name, 2];
            })
            public dependency!: AsyncDependency;
        }

        const host = await useContainer().getAsync(AsyncHost);

        expect(host.dependency).toBeInstanceOf(AsyncDependency);
        expect(host.dependency.name).toBe('async-value');
        expect(host.dependency.count).toBe(2);
    });

    test('injects Agent brain with the active agent profile', async () => {
        const agentConfig = {
            name: 'flyflor',
            model: 'test-model',
            provider: 'test-provider',
            contextLength: 16,
            maxTokens: 8,
        };

        const agent = await useContainer().getAsync(Agent, agentConfig);

        expect(agent.brain).toBeInstanceOf(Brain);
        expect(agent.brain.config).toBe(agentConfig);
        expect(typeof agent.brain.transformer).toBe('function');
    });

    test('streams Agent output through its Subject instead of returning content', async () => {
        const logPath = mkdtempSync(join(tmpdir(), 'flyflor-agent-'));
        tempPaths.push(logPath);
        configureLogger({
            consoleEnabled: false,
            path: join(logPath, 'agent.log'),
            colorEnabled: false,
            level: LoggerLevel.Debug,
        });
        const agentConfig = {
            name: 'flyflor',
            model: 'test-model',
            provider: 'test-provider',
            contextLength: 16,
            maxTokens: 8,
        };
        const agent = await useContainer().getAsync(Agent, agentConfig);
        const outputs: string[] = [];
        Object.assign(agent.brain, {
            transformer: (content: string) => `stream:${content}`,
        });

        const subscription = agent.subscribe(content => outputs.push(content));
        const result = await agent.next('hello');
        subscription.unsubscribe();

        expect(result).toBeUndefined();
        expect(outputs).toEqual(['stream:hello']);
    });
});
