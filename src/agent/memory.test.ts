import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PromptService, useContainer, type PromptPackage, type PromptPackageData } from '@/core';
import { FileService as CoreFileService } from '@/core/file/service';
import { AgentChatRole, type AgentMemory, type Intelligence } from './brain/intelligence';
import { Memory } from './memory';
import { SoulSection } from './types';

let tempPaths: string[] = [];

afterEach(() => {
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('Memory', () => {
    test('builds runtime messages without the AGENTS write-control protocol', async () => {
        const memory = await testMemory({
            prompts: {
                SOUL: 'soul',
                USER: 'user',
                AGENTS: 'agents',
                EXTENSION: 'extension',
                config: { prompt: { sections: [SoulSection.Soul, SoulSection.User, SoulSection.Agents, SoulSection.Extension, 'README'] } },
            },
        });
        memory.context.push({ role: AgentChatRole.Assistant, content: 'earlier' });

        expect(await memory.messages('hi')).toEqual([
            { role: AgentChatRole.System, content: '<SOUL>\nsoul\n</SOUL>\n\n<USER>\nuser\n</USER>\n\n<EXTENSION>\nextension\n</EXTENSION>' },
            { role: AgentChatRole.Assistant, content: 'earlier' },
            { role: AgentChatRole.User, content: 'hi' },
        ]);
    });

    test('analyzes one user turn and writes complete allowed markdown files', async () => {
        const calls: AgentMemory[][] = [];
        const memory = await testMemory({
            prompts: {
                SOUL: '# Core Identity\n\nOld identity',
                USER: '# User Profile',
                AGENTS: 'analysis protocol',
                EXTENSION: '',
                config: { protocolPackage: { editable: ['SOUL.md', 'EXTENSION.md'] } },
            },
            analysis: JSON.stringify({
                reply: '记住了。',
                writes: [
                    { file: 'SOUL.md', content: '# Core Identity\n\nNew identity' },
                    { file: 'EXTENSION.md', content: '# Extensions\n\n- codex' },
                    { file: 'AGENTS.md', content: 'mutate constitution' },
                ],
            }),
            calls,
        });

        await expect(memory.messages('以后你叫 FlyFlor')).resolves.toBe('记住了。');

        expect(memory.prompt.prompts.SOUL!.data).toBe('# Core Identity\n\nNew identity');
        expect(memory.prompt.prompts.EXTENSION!.data).toBe('# Extensions\n\n- codex');
        expect(memory.prompt.prompts.AGENTS!.data).toBe('analysis protocol');
        expect(calls[0]?.[0]).toEqual({ role: AgentChatRole.System, content: 'analysis protocol' });
        expect(JSON.parse(calls[0]?.[1]?.content ?? '{}').turn).toBe('以后你叫 FlyFlor');
    });

    test('commits a finished turn as a user/assistant pair', async () => {
        const memory = await testMemory({ prompts: { SOUL: 'soul' } });
        memory.context.push({ role: AgentChatRole.Assistant, content: 'earlier' });

        memory.commit('hi', 'hello');

        expect(memory.context).toEqual([
            { role: AgentChatRole.Assistant, content: 'earlier' },
            { role: AgentChatRole.User, content: 'hi' },
            { role: AgentChatRole.Assistant, content: 'hello' },
        ]);
    });

    test('does not write when analysis returns an empty write list', async () => {
        const memory = await testMemory({
            prompts: { SOUL: 'soul', AGENTS: 'analysis protocol' },
            analysis: '{"writes":[]}',
        });

        await expect(memory.messages('你好')).resolves.toEqual([
            { role: AgentChatRole.System, content: '<SOUL>\nsoul\n</SOUL>' },
            { role: AgentChatRole.User, content: '你好' },
        ]);

        expect(memory.prompt.prompts.SOUL!.data).toBe('soul');
    });

    test('honors runtimeIgnored files when building runtime messages', async () => {
        const memory = await testMemory({
            prompts: {
                SOUL: 'soul',
                USER: 'user',
                EXTENSION: 'extension',
                config: {
                    prompt: { sections: [SoulSection.Soul, SoulSection.User, SoulSection.Extension] },
                    protocolPackage: { runtimeIgnored: ['USER.md'] },
                },
            },
        });

        await expect(memory.messages('hi')).resolves.toEqual([
            { role: AgentChatRole.System, content: '<SOUL>\nsoul\n</SOUL>\n\n<EXTENSION>\nextension\n</EXTENSION>' },
            { role: AgentChatRole.User, content: 'hi' },
        ]);
    });
});

async function testMemory(options: {
    prompts?: PromptPackageData;
    analysis?: string;
    calls?: AgentMemory[][];
}): Promise<Memory> {
    const config = {
        name: 'flyflor',
        model: 'test-model',
        provider: 'test-provider',
        contextLength: 1024,
        maxTokens: 64,
    };
    const memory = await useContainer().getAsync(Memory, config);
    const prompt = await useContainer().getAsync(PromptService, config);
    prompt.prompts = promptPackage(options.prompts ?? {});
    memory.prompt = prompt;
    memory.intelligence = {
        async complete(messages: AgentMemory[]) {
            options.calls?.push(messages);
            return options.analysis ?? '{"writes":[]}';
        },
    } as unknown as Intelligence;
    return memory;
}

function promptPackage(data: PromptPackageData): PromptPackage {
    const root = mkdtempSync(join(tmpdir(), 'flyflor-memory-'));
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
