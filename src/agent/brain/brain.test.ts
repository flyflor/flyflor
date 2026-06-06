import { describe, expect, test } from 'bun:test';
import { FileService, useContainer } from '@/core';
import { Brain } from './brain';
import { AgentChatRole, type AgentChatMessage, type Intelligence, type IntelligenceTurn } from './intelligence';
import { SoulSection } from '../types';

describe('Brain intelligence orchestration', () => {
    test('builds one turn, streams through flowing intelligence, and commits the result', async () => {
        const brain = await brainWithPrompt({
            [SoulSection.Soul]: 'follow the constitution',
            [SoulSection.Memory]: 'remember the user',
        });
        const seenTurns: AgentChatMessage[][] = [];
        setProviderStream(brain, (messages: AgentChatMessage[]) => {
            seenTurns.push(messages);
            return streamFromText('hel', 'lo');
        });

        await expect(collect(brain.transformer('hi'))).resolves.toBe('hello');
        expect(seenTurns).toEqual([[
            {
                role: AgentChatRole.System,
                content: '<SOUL>\nfollow the constitution\n</SOUL>\n\n<MEMORY>\nremember the user\n</MEMORY>',
            },
            {
                role: AgentChatRole.User,
                content: 'hi',
            },
        ]]);
        expect(brain.context).toEqual([
            { role: AgentChatRole.User, content: 'hi' },
            { role: AgentChatRole.Assistant, content: 'hello' },
        ]);
    });

    test('does not commit context when flowing intelligence fails mid-turn', async () => {
        const brain = await brainWithPrompt({
            [SoulSection.Soul]: 'follow the constitution',
        });
        setProviderStream(brain, () => {
            return new ReadableStream<string>({
                start(controller) {
                    controller.enqueue('partial');
                    controller.error(Error('provider failed'));
                },
            });
        });

        await expect(collect(brain.transformer('hi'))).rejects.toThrow('provider failed');
        expect(brain.context).toEqual([]);
    });

    test('does not commit context when the caller cancels the turn stream', async () => {
        const brain = await brainWithPrompt({
            [SoulSection.Soul]: 'follow the constitution',
        });
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

        const turn = brain.transformer('hi');
        await expect(turn.next()).resolves.toMatchObject({ done: false, value: 'partial' });
        await turn.return(undefined);

        expect(cancelled).toBe(true);
        expect(brain.context).toEqual([]);
    });
});

async function brainWithPrompt(prompt: Partial<Record<SoulSection, string>>): Promise<Brain> {
    const brain = await useContainer().getAsync(Brain, {
        name: 'flyflor',
        model: 'test-model',
        provider: 'test-provider',
        contextLength: 1024,
        maxTokens: 64,
    });
    const promptFile = useContainer().create(FileService, '') as FileService<Partial<Record<SoulSection, string>>>;
    promptFile.data = prompt;
    brain.prompt = promptFile;
    return brain;
}

function setProviderStream(brain: Brain, stream: (messages: AgentChatMessage[]) => ReadableStream<string>): void {
    brain.intelligence = {
        turn(messages: AgentChatMessage[]): IntelligenceTurn {
            const reader = stream(messages).getReader();
            return {
                read: () => reader.read(),
                cancel: (reason?: unknown) => reader.cancel(reason),
                release: () => reader.releaseLock(),
            };
        },
    } as Intelligence;
}

async function collect(stream: AsyncGenerator<string>): Promise<string> {
    let content = '';
    try {
        while (true) {
            const { done, value } = await stream.next();
            if (done) break;
            content += value;
        }
    } finally {
        await stream.return(undefined);
    }
    return content;
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
