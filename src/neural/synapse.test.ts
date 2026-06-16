import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { SocketEvent, type SocketPacket } from './packet';
import { Synapse } from './synapse';
import type { AgentTurnInput } from '@/agent/memory';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class TestSynapse extends Synapse {
    public readonly inputs: AgentTurnInput[] = [];

    public constructor() {
        super();
        this.agentPool = {
            active: 'test',
            agents: {
                test: {
                    run: async (input: AgentTurnInput) => {
                        this.inputs.push(input);
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
    });
});
