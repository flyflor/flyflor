import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import '@/plugins/tools';
import { ROOT_PATH } from '@/config';
import { PromptService, useContainer, type PromptPackage, type PromptPackageData } from '@/core';
import { FileService as CoreFileService } from '@/core/file/service';
import { AgentChatRole, type AgentMemory, type Intelligence } from '@/agent/brain/intelligence';
import { Route } from './service';

const TEST_DIR = join(ROOT_PATH, '.tmp-route');
let tempPaths: string[] = [];

afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('Route', () => {
    test('updates the protocol package and returns a direct reply', async () => {
        const calls: AgentMemory[][] = [];
        const route = await testRoute({
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

        const turn = await route.navigate('以后你叫 FlyFlor');

        expect(turn).toMatchObject({ action: 'reply', reply: '记住了。' });
        expect(route.prompt.prompts.SOUL!.data).toBe('# Core Identity\n\nNew identity');
        expect(route.prompt.prompts.EXTENSION!.data).toBe('# Extensions\n\n- codex');
        expect(route.prompt.prompts.AGENTS!.data).toBe('analysis protocol');
        expect(calls[0]?.[0]).toEqual({ role: AgentChatRole.System, content: 'analysis protocol' });
        expect(JSON.parse(calls[0]?.[1]?.content ?? '{}').turn).toBe('以后你叫 FlyFlor');
    });

    test('investigates with read-only tools and compresses a route brief', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'route.ts'), 'export type RouteSignal = "route";\n', 'utf8');
        const calls: AgentMemory[][] = [];
        const route = await testRoute({
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

        const turn = await route.navigate('Implement the plan.', { history: [{ role: AgentChatRole.Assistant, content: 'previous' }] });

        expect(turn.action).toBe('execute');
        expect(turn.brief).toMatchObject({
            userIntent: 'Implement route execution plumbing',
            relatedFiles: ['.tmp-route/route.ts'],
        });
        expect(turn.decision?.investigation.map((call) => call.name)).toEqual(['grep', 'bash']);
        expect(calls).toHaveLength(3);
        expect(calls[1]?.[0]?.content).toContain('Flyflor Route');
        expect(calls[2]?.[1]?.content).toContain('RouteSignal');
        expect(calls[2]?.[1]?.content).not.toContain('printf unsafe');
    });

    test('routes ordinary chat without an investigation brief', async () => {
        const route = await testRoute({
            prompts: {
                SOUL: 'soul',
                AGENTS: 'analysis protocol',
            },
            responses: [
                '{"writes":[]}',
                '{"needsTools":false,"taskType":"chat","summary":"Say hello","investigation":[]}',
            ],
        });

        const turn = await route.navigate('hello');

        expect(turn).toMatchObject({ action: 'chat' });
        expect(turn.brief).toBeUndefined();
    });
});

async function testRoute(options: {
    prompts?: PromptPackageData;
    responses: string[];
    calls?: AgentMemory[][];
}): Promise<Route> {
    const config = {
        name: 'flyflor',
        model: 'test-model',
        provider: 'test-provider',
        contextLength: 1024,
        maxTokens: 64,
    };
    const route = await useContainer().getAsync(Route, config);
    const prompt = await useContainer().getAsync(PromptService, config);
    prompt.prompts = promptPackage(options.prompts ?? {});
    route.prompt = prompt;
    route.intelligence = fakeIntelligence(options.calls ?? [], options.responses);
    return route;
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

function promptPackage(data: PromptPackageData): PromptPackage {
    const root = mkdtempSync(join(tmpdir(), 'flyflor-route-'));
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
