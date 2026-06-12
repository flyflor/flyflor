import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ROOT_PATH } from '@/config';
import { PromptService, useContainer, type PromptPackage, type PromptPackageData } from '@/core';
import { ToolRegistry } from '@/tools';
import { FileService as CoreFileService } from '@/core/file/service';
import { AgentChatRole, type AgentMemory, type Intelligence } from '@/agent/brain/intelligence';
import { Callosal, CallosalAction, CALLOSAL_ROUTE_BLOCK, CALLOSAL_INVESTIGATION_BLOCK } from '../callosal';

const TEST_DIR = join(ROOT_PATH, '.tmp-route');
let tempPaths: string[] = [];

afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('Callosal', () => {
    test('updates the protocol package and returns a direct reply', async () => {
        const calls: AgentMemory[][] = [];
        const callosal = await testCallosal({
            prompts: {
                SOUL: '# Core Identity\n\nOld identity',
                USER: '# User Profile',
                AGENTS: 'analysis protocol',
                EXTENSION: '',
                config: { protocolPackage: { editable: ['SOUL.md', 'EXTENSION.md'] } },
            },
            responses: [
                JSON.stringify({
                    reply: '记住了。',
                    writes: [
                        { file: 'SOUL.md', content: '# Core Identity\n\nNew identity' },
                        { file: 'EXTENSION.md', content: '# Extensions\n\n- codex' },
                        { file: 'AGENTS.md', content: 'mutate constitution' },
                    ],
                }),
            ],
            calls,
        });

        const turn = await callosal.navigate('以后你叫 FlyFlor');

        expect(turn).toMatchObject({ action: CallosalAction.Reply, reply: '记住了。' });
        expect(callosal.promptSvc.prompts.SOUL!.data).toBe('# Core Identity\n\nNew identity');
        expect(callosal.promptSvc.prompts.EXTENSION!.data).toBe('# Extensions\n\n- codex');
        expect(callosal.promptSvc.prompts.AGENTS!.data).toBe('analysis protocol');
        expect(calls[0]?.[0]).toEqual({ role: AgentChatRole.System, content: 'analysis protocol' });
        expect(JSON.parse(calls[0]?.[1]?.content ?? '{}')).toEqual({ turn: '以后你叫 FlyFlor' });
    });

    test('investigates with read-only tools and compresses an execution brief', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'route.ts'), 'export type RouteSignal = "route";\n', 'utf8');
        const calls: AgentMemory[][] = [];
        const callosal = await testCallosal({
            prompts: {
                SOUL: 'soul',
                AGENTS: 'analysis protocol',
            },
            responses: [
                '{"writes":[]}',
                JSON.stringify({
                    needsTools: true,
                    taskType: 'coding',
                    summary: 'Implement route execution plumbing',
                    investigation: [
                        { name: 'grep', input: { query: 'RouteSignal', include: '.tmp-route/*.ts' } },
                        { name: 'bash', input: { command: 'printf unsafe' } },
                    ],
                }),
                JSON.stringify({
                    userIntent: 'Implement route execution plumbing',
                    taskType: 'coding',
                    needsTools: true,
                    relatedFiles: ['.tmp-route/route.ts'],
                    evidence: ['.tmp-route/route.ts defines RouteSignal'],
                    instructions: 'Use the route brief, then execute with tools.',
                }),
            ],
            calls,
        });

        const turn = await callosal.navigate('Implement the plan.', { history: [{ role: AgentChatRole.Assistant, content: 'previous' }] });

        expect(turn.action).toBe(CallosalAction.Execute);
        expect(turn.brief).toMatchObject({
            userIntent: 'Implement route execution plumbing',
            relatedFiles: ['.tmp-route/route.ts'],
        });
        // bash is mutating — the investigation gate structurally excludes it; only grep runs.
        expect(turn.decision?.investigation.map((call) => call.name)).toEqual(['grep', 'bash']);
        expect(calls).toHaveLength(3);
        expect(calls[1]?.[0]?.content).toContain('Flyflor Route');
        expect(calls[2]?.[0]?.content).toContain('Flyflor Investigation');
    });

    test('routes ordinary chat without an investigation brief', async () => {
        const callosal = await testCallosal({
            prompts: {
                SOUL: 'soul',
                AGENTS: 'analysis protocol',
            },
            responses: [
                '{"writes":[]}',
                '{"needsTools":false,"taskType":"chat","summary":"Say hello","investigation":[]}',
            ],
        });

        const turn = await callosal.navigate('hello');

        expect(turn).toMatchObject({ action: CallosalAction.Chat });
        expect(turn.brief).toBeUndefined();
    });
});

async function testCallosal(options: {
    prompts?: PromptPackageData;
    responses: string[];
    calls?: AgentMemory[][];
}): Promise<Callosal> {
    const config = {
        name: 'flyflor',
        model: 'test-model',
        provider: 'test-provider',
        contextLength: 1024,
        maxTokens: 64,
    };
    const callosal = await useContainer().getAsync(Callosal, config);
    const prompt = await useContainer().getAsync(PromptService, config);
    prompt.prompts = promptPackage(options.prompts ?? {});
    // Set up prompt blocks for the route/investigation delegation — the AGENTS content
    // contains the block body already, so make it visible to the callosal.
    const agentsContent = prompt.prompts.AGENTS?.data;
    if (typeof agentsContent === 'string' && agentsContent.length > 0) {
        const blocks: Record<string, { body: string; enabled: boolean }> = { ...((prompt.prompts as Record<string, unknown>).blocks as Record<string, { body: string; enabled: boolean }> ?? {}) };
        blocks[CALLOSAL_ROUTE_BLOCK] = { body: agentsContent, enabled: true };
        blocks[CALLOSAL_INVESTIGATION_BLOCK] = { body: agentsContent, enabled: true };
        Object.defineProperty(prompt.prompts, 'blocks', { value: blocks, writable: true, enumerable: false });
    }
    callosal.promptSvc = prompt;
    callosal.intelligence = fakeIntelligence(options.calls ?? [], options.responses);
    callosal.registry = fakeRegistry();
    return callosal;
}

function fakeIntelligence(seen: AgentMemory[][], responses: string[]): Intelligence {
    let index = 0;
    return {
        async complete(messages: AgentMemory[]): Promise<string> {
            seen.push(messages);
            return responses[index++] ?? '{"writes":[]}';
        },
        cancel() {},
    } as unknown as Intelligence;
}

function fakeRegistry(): ToolRegistry {
    return {
        list: async () => [],
        dispatch: async () => ({ name: '', input: {}, ok: true, result: '' }),
        extractObject: (text: string) => {
            const start = text.indexOf('{');
            if (start === -1) return undefined;
            let depth = 0;
            for (let i = start; i < text.length; i++) {
                if (text[i] === '{') depth++;
                if (text[i] === '}') {
                    depth--;
                    if (depth === 0) return text.slice(start, i + 1);
                }
            }
            return undefined;
        },
    } as unknown as ToolRegistry;
}

function promptPackage(data: PromptPackageData): PromptPackage {
    const root = mkdtempSync(join(tmpdir(), 'flyflor-callosal-'));
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
