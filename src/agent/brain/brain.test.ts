import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PromptService, useContainer, type PromptPackage, type PromptPackageData } from '@/core';
import { FileService as CoreFileService } from '@/core/file/service';
import { Memory } from '../memory';
import { Brain } from './brain';
import { AgentChatRole, type AgentMemory, type Intelligence } from './intelligence';

let tempPaths: string[] = [];

afterEach(() => {
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('Brain transformer', () => {
    test('analyzes first, streams visible provider chunks, and commits the result', async () => {
        const brain = await testBrain({ analysis: '{"writes":[]}' });
        const history: AgentMemory[] = [
            { role: AgentChatRole.User, content: 'earlier' },
            { role: AgentChatRole.Assistant, content: 'noted' },
        ];
        brain.memory.context.push(...history);
        const seenTurns: AgentMemory[][] = [];
        setProviderStream(brain, (messages) => {
            seenTurns.push(messages);
            return streamFromText('hel', 'lo');
        });

        await expect(collect(brain.transformer('hi'))).resolves.toBe('hello');

        expect(seenTurns).toEqual([[
            { role: AgentChatRole.System, content: '<SOUL>\nfollow the constitution\n</SOUL>' },
            ...history,
            { role: AgentChatRole.User, content: 'hi' },
        ]]);
        expect(brain.memory.context).toEqual([
            ...history,
            { role: AgentChatRole.User, content: 'hi' },
            { role: AgentChatRole.Assistant, content: 'hello' },
        ]);
    });

    test('returns analysis reply directly when the protocol package was updated', async () => {
        const brain = await testBrain({
            analysis: JSON.stringify({
                reply: '记住了。',
                writes: [{ file: 'SOUL.md', content: 'updated soul' }],
            }),
        });
        let streamed = false;
        setProviderStream(brain, () => {
            streamed = true;
            return streamFromText('main answer');
        });

        await expect(collect(brain.transformer('以后你叫 FlyFlor'))).resolves.toBe('记住了。');

        expect(streamed).toBe(false);
        expect(brain.memory.prompt.prompts.SOUL!.data).toBe('updated soul');
        expect(brain.memory.context).toEqual([
            { role: AgentChatRole.User, content: '以后你叫 FlyFlor' },
            { role: AgentChatRole.Assistant, content: '记住了。' },
        ]);
    });

    test('does not commit context when intelligence fails mid-stream', async () => {
        const brain = await testBrain({ analysis: '{"writes":[]}' });
        setProviderStream(brain, () => {
            return new ReadableStream<string>({
                start(controller) {
                    controller.enqueue('partial');
                    controller.error(Error('provider failed'));
                },
            });
        });

        await expect(collect(brain.transformer('hi'))).rejects.toThrow('provider failed');
        expect(brain.memory.context).toEqual([]);
    });

    test('cancels the intelligence reader and does not commit context when the caller stops early', async () => {
        const brain = await testBrain({ analysis: '{"writes":[]}' });
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
        expect(brain.memory.context).toEqual([]);
    });
});

async function testBrain(options: { analysis: string }): Promise<Brain> {
    const config = {
        name: 'flyflor',
        model: 'test-model',
        provider: 'test-provider',
        contextLength: 1024,
        maxTokens: 64,
    };
    const brain = await useContainer().getAsync(Brain, config);
    brain.memory = await useContainer().getAsync(Memory, brain.config);
    brain.memory.prompt = await useContainer().getAsync(PromptService, brain.config);
    brain.memory.prompt.prompts = promptPackage({
        SOUL: 'follow the constitution',
        AGENTS: 'analysis protocol',
        config: { prompt: { sections: ['SOUL'] }, protocolPackage: { editable: ['SOUL.md', 'USER.md', 'EXTENSION.md'] } },
    });
    brain.memory.intelligence = {
        async complete() {
            return options.analysis;
        },
    } as unknown as Intelligence;
    return brain;
}

function setProviderStream(brain: Brain, stream: (messages: AgentMemory[]) => ReadableStream<string>): void {
    brain.intelligence = {
        reader(messages: AgentMemory[]) {
            return stream(messages).getReader();
        },
    } as unknown as Intelligence;
}

function promptPackage(data: PromptPackageData): PromptPackage {
    const root = mkdtempSync(join(tmpdir(), 'flyflor-brain-'));
    tempPaths.push(root);
    for (const [key, value] of Object.entries(data)) {
        if (key === 'config') {
            writeFileSync(join(root, 'config.jsonc'), JSON.stringify(value), 'utf-8');
            continue;
        }
        if (typeof value === 'string') {
            writeFileSync(join(root, `${key}.md`), value, 'utf-8');
        }
    }
    return useContainer().create(CoreFileService, root).reload() as PromptPackage;
}

async function collect(stream: AsyncGenerator<string>): Promise<string> {
    let content = '';
    while (true) {
        const { done, value } = await stream.next();
        if (done) break;
        content += value;
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
