import { describe, expect, test } from 'bun:test';
import { FAgent, useContainer } from '@/core';
import type { FAgentProfileConfiguration } from '@/config';
import { Model } from './service';
import type { StreamEvent } from './types';

class ModelAgent extends FAgent<unknown, unknown, FAgentProfileConfiguration, unknown> {
    /** EN: Returns no cognition in this model-scope fixture. ZH: 在该 model scope fixture 中不返回认知。 */
    public async receive(): Promise<unknown> {
        return undefined;
    }
}

function modelWith(events: StreamEvent[]): Model {
    const agent = useContainer().create(ModelAgent, {
        name: 'worker',
        model: 'profile-model',
        provider: 'openai',
        contextLength: 4096,
        maxTokens: 1024,
    }, undefined);
    const model = useContainer().create(Model, agent);
    model.root = {
        model: {
            model: 'root-model',
            provider: 'root-provider',
            apiKeyEnv: 'MODEL_KEY',
            baseUrl: 'http://localhost',
            timeoutSeconds: 60,
        },
    } as never;
    model.client = {
        stream: () => new ReadableStream<StreamEvent>({
            start: (controller) => {
                for (const event of events) controller.enqueue(event);
                controller.close();
            },
        }),
    } as never;
    model.initProfile();
    return model;
}

describe('Model', () => {
    test('rejects configuration reads before scoped initialization', () => {
        const agent = useContainer().create(ModelAgent, {
            name: 'worker',
            model: 'profile-model',
            provider: 'profile-provider',
            contextLength: 100,
            maxTokens: 20,
        }, undefined);
        const model = useContainer().create(Model, agent);

        expect(() => model.config).toThrow('Agent model is not initialized: worker');
    });

    test('owns profile context capacity and reports pressure at the usable threshold', () => {
        const agent = useContainer().create(ModelAgent, {
            name: 'worker',
            model: 'profile-model',
            provider: 'profile-provider',
            contextLength: 100,
            maxTokens: 20,
        }, undefined);
        const model = useContainer().create(Model, agent);
        model.root = {
            model: {
                model: 'root-model',
                provider: 'root-provider',
                apiKeyEnv: 'MODEL_KEY',
                baseUrl: 'http://localhost',
                timeoutSeconds: 60,
            },
        } as never;

        model.initProfile();

        expect(model.config.contextLength).toBe(100);
        expect(model.config.maxTokens).toBe(20);
        expect(model.needsSummary([{ role: 'user', content: 'short' }])).toBe(false);
        expect(model.needsSummary([{ role: 'user', content: 'x'.repeat(1000) }])).toBe(true);
    });

    test('returns only the fully consumed result after one normal terminal', async () => {
        const model = modelWith([
            { type: 'text_delta', text: 'answer' },
            { type: 'reasoning_delta', text: 'evidence' },
            { type: 'done', stopReason: 'stop' },
        ]);

        await expect(model.run([{ role: 'user', content: 'question' }])).resolves.toEqual({
            text: 'answer',
            reasoning: 'evidence',
            toolCalls: [],
        });
    });

    test('awaits text consumers before accepting the terminal event', async () => {
        const model = modelWith([
            { type: 'text_delta', text: 'answer' },
            { type: 'done', stopReason: 'stop' },
        ]);
        let release!: () => void;
        let consumed = false;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const stream = model.stream([{ role: 'user', content: 'question' }], async () => {
            await gate;
            consumed = true;
        });

        await Promise.resolve();
        expect(consumed).toBe(false);
        release();
        await stream;
        expect(consumed).toBe(true);
    });

    test('rejects missing, repeated, and truncated terminals', async () => {
        await expect(modelWith([{ type: 'text_delta', text: 'partial' }]).run([
            { role: 'user', content: 'question' },
        ])).rejects.toThrow('without a terminal event');
        await expect(modelWith([
            { type: 'done', stopReason: 'stop' },
            { type: 'done', stopReason: 'stop' },
        ]).run([{ role: 'user', content: 'question' }])).rejects.toThrow('after its terminal event');
        await expect(modelWith([
            { type: 'text_delta', text: 'partial' },
            { type: 'done', stopReason: 'length' },
        ]).run([{ role: 'user', content: 'question' }])).rejects.toThrow('token limit');
    });

    test('rejects tool-use terminals that disagree with completed calls', async () => {
        const call = { id: 'call_1', name: 'filesystem', arguments: { action: 'read' } };
        await expect(modelWith([
            { type: 'tool_end', index: 0, call },
            { type: 'done', stopReason: 'stop' },
        ]).run([{ role: 'user', content: 'question' }])).rejects.toThrow('does not match tool calls');
        await expect(modelWith([
            { type: 'done', stopReason: 'toolUse' },
        ]).run([{ role: 'user', content: 'question' }])).rejects.toThrow('does not match tool calls');
    });

    test('rejects tool calls on a text-only request', async () => {
        const call = { id: 'call_1', name: 'filesystem', arguments: { action: 'read' } };
        const events: StreamEvent[] = [
            { type: 'tool_end', index: 0, call },
            { type: 'done', stopReason: 'toolUse' },
        ];

        await expect(modelWith(events).run([{ role: 'user', content: 'question' }])).rejects.toThrow('Text-only model response used tools');
        await expect(modelWith(events).run([{ role: 'user', content: 'question' }], [{
            name: 'filesystem',
            description: 'read files',
            parameters: { type: 'object' },
        }])).resolves.toMatchObject({ toolCalls: [call] });
    });
});
