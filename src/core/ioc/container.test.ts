import { afterEach, describe, expect, test } from 'bun:test';
import { Agent } from '@/agent';
import { Brain } from '@/agent/brain';
import { Init, Inject, Service, Singleton, useContainer } from '@/core';
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
    test('creates fresh non-singleton provider instances through getAsync', async () => {
        @Service()
        class TransientDependency {}

        const first = await useContainer().getAsync(TransientDependency);
        const second = await useContainer().getAsync(TransientDependency);

        expect(first).toBeInstanceOf(TransientDependency);
        expect(second).toBeInstanceOf(TransientDependency);
        expect(first).not.toBe(second);
    });

    test('reuses singleton provider instances through getAsync', async () => {
        @Singleton()
        class SharedDependency {}

        const first = await useContainer().getAsync(SharedDependency);
        const second = await useContainer().getAsync(SharedDependency);

        expect(first).toBe(second);
    });

    test('creates synchronous instances through get when the dependency graph is sync-only', () => {
        @Service()
        class SyncDependency {}

        const first = useContainer().get(SyncDependency);
        const second = useContainer().get(SyncDependency);

        expect(first).toBeInstanceOf(SyncDependency);
        expect(second).toBeInstanceOf(SyncDependency);
        expect(first).not.toBe(second);
    });

    test('reuses cached singletons through get', () => {
        @Singleton()
        class SharedDependency {}

        const first = useContainer().get(SharedDependency);
        const second = useContainer().get(SharedDependency);

        expect(first).toBe(second);
    });

    test('reuses async-initialized singletons through get even when they define @Init', async () => {
        @Singleton()
        class InitializedSingleton {
            public initialized = false;

            @Init()
            public async init() {
                this.initialized = true;
            }
        }

        const first = await useContainer().getAsync(InitializedSingleton);
        const second = useContainer().get(InitializedSingleton);

        expect(first.initialized).toBe(true);
        expect(second).toBe(first);
    });

    test('throws when get would need to run @Init during sync construction', () => {
        @Singleton()
        class InitializedSingleton {
            @Init()
            public async init() {}
        }

        expect(() => useContainer().get(InitializedSingleton)).toThrow('does not support @Init');
    });

    test('throws when get hits an async @Inject callback', () => {
        class AsyncDependency {
            constructor(public readonly name: string) {}
        }

        class AsyncHost {
            public readonly name = 'async-value';

            @Inject(async function (this: AsyncHost) {
                return this.name;
            })
            public dependency!: AsyncDependency;
        }

        expect(() => useContainer().get(AsyncHost)).toThrow('does not support async dependency factories');
    });

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
        const committed: string[] = [];
        Object.assign(agent.brain, {
            prepareTurn: async (content: string) => ({
                investigation: {
                    state: {
                        explicit_requests: [content],
                        implicit_goals: [],
                        constraints: [],
                        unknowns: [],
                        hypotheses: [],
                        evidence: [],
                        information_needed: [],
                        next_question: '',
                        confidence: 0.8,
                    },
                    observations: [],
                },
                messages: [{ role: 'user', content }],
            }),
            streamTurn: async function* () {
                yield 'stream:hello';
            },
            commitTurn: (content: string, assistant: string) => {
                committed.push(`${content}:${assistant}`);
            },
        });

        const subscription = agent.subscribe(content => outputs.push(content));
        const result = await agent.next('hello');
        subscription.unsubscribe();

        expect(result).toBeUndefined();
        expect(outputs).toEqual(['stream:hello']);
        expect(committed).toEqual(['hello:stream:hello']);
        expect(agent.memory.turns[0]?.assistant).toBe('stream:hello');
    });
});
