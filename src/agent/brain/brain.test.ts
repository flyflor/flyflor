import { describe, expect, test } from 'bun:test';
import { lastValueFrom, take, toArray } from 'rxjs';
import { useContainer, type AgentSignal } from '@/core';
import { Brain } from './brain';
import { AgentChatRole, type AgentMemory, type Intelligence } from './intelligence';

describe('Brain transform', () => {
    test('streams visible provider chunks as delta signals and ends with done', async () => {
        const brain = await testBrain();
        const seenTurns: AgentMemory[][] = [];
        setProviderStream(brain, (messages) => {
            seenTurns.push(messages);
            return streamFromText('hel', 'lo');
        });
        const messages: AgentMemory[] = [{ role: AgentChatRole.User, content: 'hi' }];

        const signals = await lastValueFrom(brain.transform(messages).pipe(toArray()));

        expect(seenTurns).toEqual([messages]);
        expect(signals).toEqual([
            { type: 'delta', text: 'hel' },
            { type: 'delta', text: 'lo' },
            { type: 'done' },
        ]);
    });

    test('errors the stream when intelligence fails mid-stream', async () => {
        const brain = await testBrain();
        setProviderStream(brain, () => {
            return new ReadableStream<string>({
                start(controller) {
                    controller.enqueue('partial');
                    controller.error(Error('provider failed'));
                },
            });
        });

        await expect(lastValueFrom(brain.transform([{ role: AgentChatRole.User, content: 'hi' }]).pipe(toArray()))).rejects.toThrow('provider failed');
    });

    test('cancels the provider reader when the subscriber stops early', async () => {
        const brain = await testBrain();
        let cancelled = false;
        setProviderStream(brain, () => {
            return new ReadableStream<string>({
                start(controller) {
                    controller.enqueue('partial');
                },
                cancel() {
                    cancelled = true;
                },
            });
        });

        const first = await lastValueFrom(brain.transform([{ role: AgentChatRole.User, content: 'hi' }]).pipe(take(1)));

        expect(first).toEqual({ type: 'delta', text: 'partial' });
        expect(cancelled).toBe(true);
    });
});

async function testBrain(): Promise<Brain> {
    return useContainer().getAsync(Brain, {
        name: 'flyflor',
        model: 'test-model',
        provider: 'test-provider',
        contextLength: 1024,
        maxTokens: 64,
    });
}

function setProviderStream(brain: Brain, stream: (messages: AgentMemory[]) => ReadableStream<string>): void {
    brain.intelligence = {
        reader(messages: AgentMemory[]) {
            return stream(messages).getReader();
        },
    } as unknown as Intelligence;
}

function streamFromText(...chunks: string[]): ReadableStream<string> {
    return new ReadableStream<string>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(chunk);
            }
            controller.close();
        },
    });
}
