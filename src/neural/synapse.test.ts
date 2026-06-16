import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { SocketEvent, type SocketPacket } from './packet';
import { Synapse } from './synapse';
import type { AgentTurnInput } from '@/agent/memory';
import { ContextIntent, type CompletedSummary, type TurnUnderstanding } from './context';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class TestSynapse extends Synapse {
    public readonly inputs: AgentTurnInput[] = [];
    public readonly memory: {
        current?: TurnUnderstanding;
        working: [];
        completed: CompletedSummary[];
        load: (understanding: TurnUnderstanding) => void;
        ingest: (input: AgentTurnInput) => Promise<TurnUnderstanding>;
        settle: () => Promise<CompletedSummary>;
        rememberCompletion: (summary: CompletedSummary) => void;
    } = {
        working: [],
        completed: [],
        load: (understanding) => {
            this.memory.current = understanding;
        },
        ingest: async (input) => {
            const understanding = {
                userText: input.content,
                intent: ContextIntent.Reply,
                goal: input.content,
                constraints: [],
                references: [],
                knownDone: [],
                openQuestions: [],
                shouldInvestigate: false,
            };
            this.memory.load(understanding);
            return understanding;
        },
        settle: async () => {
            const summary = {
                goal: this.memory.current?.goal ?? '',
                result: 'done',
                changedFiles: [],
                decisions: [],
                evidence: [],
                remaining: [],
                createdAt: 1,
            };
            this.memory.rememberCompletion(summary);
            return summary;
        },
        rememberCompletion: (summary) => {
            this.memory.completed.push(summary);
        },
    };

    public constructor() {
        super();
        this.agentPool = {
            active: 'test',
            agents: {
                test: {
                    memory: this.memory,
                    run: async (input: AgentTurnInput) => {
                        this.inputs.push(input);
                        return { user: input.content, assistant: 'done', completed: true };
                    },
                } as never,
            },
        };
    }
}

describe('Synapse', () => {
    test('normalizes structured user payloads before entering the agent', async () => {
        const synapse = useContainer().create(TestSynapse);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-synapse-root-'));
        const packet: SocketPacket = {
            action: SocketEvent.User,
            data: {
                text: `研究下这个项目 ${root}`,
                workingDirectory: '/tmp/workspace',
            },
        };

        await synapse.next(packet);

        expect(synapse.inputs).toEqual([
            {
                content: `研究下这个项目 ${root}`,
                workingDirectory: '/tmp/workspace',
                toolRoots: [realpathSync(root)],
            },
        ]);
    });

    test('strips execution-directory metadata from legacy text payloads', async () => {
        const synapse = useContainer().create(TestSynapse);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-synapse-text-root-'));
        const workingDirectory = '/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor';

        await synapse.next({
            action: SocketEvent.User,
            data: `研究下这个项目 ${root}\n执行目录: ${workingDirectory}`,
        });

        expect(synapse.inputs).toEqual([
            {
                content: `研究下这个项目 ${root}`,
                workingDirectory,
                toolRoots: [realpathSync(root)],
            },
        ]);
    });

    test('keeps legacy string user payloads working', async () => {
        const synapse = useContainer().create(TestSynapse);

        await synapse.next({ action: SocketEvent.User, data: 'hello' });

        expect(synapse.inputs).toEqual([{ content: 'hello' }]);
        expect(synapse.memory.current?.goal).toBe('hello');
        expect(synapse.memory.completed).toHaveLength(1);
    });
});
