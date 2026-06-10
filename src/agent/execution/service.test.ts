import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import '@/plugins/tools';
import { ROOT_PATH } from '@/config';
import { useContainer } from '@/core';
import { AgentChatRole, type AgentMemory, type Intelligence } from '@/agent/brain/intelligence';
import { Execution } from './service';

const TEST_DIR = join(ROOT_PATH, '.tmp-execution');

afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Execution.run', () => {
    test('executes tool calls and feeds results back into the model', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'note.txt'), 'execution evidence', 'utf8');
        const execution = await useContainer().getAsync(Execution);
        const seen: AgentMemory[][] = [];
        execution.intelligence = fakeIntelligence(seen, [
            '{"type":"tool","calls":[{"name":"read","input":{"path":".tmp-execution/note.txt"}}]}',
            '{"type":"final","text":"done"}',
        ]);

        const result = await execution.run([{ role: AgentChatRole.User, content: 'read note' }]);

        expect(result).toMatchObject({ ok: true, text: 'done', reason: 'final' });
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]?.result).toMatchObject({ ok: true, name: 'read' });
        expect(seen[1]?.some((message) => message.content.includes('flyflor:tool_results'))).toBe(true);
    });

    test('executes flyflor tool blocks even when the response includes prose', async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(join(TEST_DIR, 'note.txt'), 'tagged execution evidence', 'utf8');
        const execution = await useContainer().getAsync(Execution);
        execution.intelligence = fakeIntelligence([], [
            'I will inspect first.\n<flyflor:tool>\n{"name":"read","input":{"path":".tmp-execution/note.txt"}}\n</flyflor:tool>',
            '{"type":"final","text":"done"}',
        ]);

        const result = await execution.run([{ role: AgentChatRole.User, content: 'read note' }]);

        expect(result).toMatchObject({ ok: true, text: 'done', reason: 'final' });
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]?.call.name).toBe('read');
        expect(result.toolCalls[0]?.result?.output).toContain('tagged execution evidence');
    });

    test('does not advertise or execute the plan tool by default', async () => {
        const execution = await useContainer().getAsync(Execution);
        const seen: AgentMemory[][] = [];
        execution.intelligence = fakeIntelligence(seen, [
            '{"type":"tool","calls":[{"name":"plan","input":{"steps":[]}}]}',
            '{"type":"final","text":"done"}',
        ]);

        const result = await execution.run([{ role: AgentChatRole.User, content: 'do work' }]);

        expect(seen[0]?.[0]?.content).not.toContain('"name": "plan"');
        expect(result.toolCalls[0]?.result).toMatchObject({ ok: false, code: 'disabled_tool', name: 'plan' });
    });

    test('stops when the model asks the user', async () => {
        const execution = await useContainer().getAsync(Execution);
        execution.intelligence = fakeIntelligence([], [
            '{"type":"tool","calls":[{"name":"ask","input":{"question":"Which file should I edit?"}}]}',
        ]);

        const result = await execution.run([{ role: AgentChatRole.User, content: 'edit it' }]);

        expect(result).toMatchObject({ ok: true, text: 'Which file should I edit?', reason: 'ask' });
    });
});

function fakeIntelligence(seen: AgentMemory[][], responses: string[]): Intelligence {
    let index = 0;
    return {
        async complete(messages: AgentMemory[]): Promise<string> {
            seen.push(messages);
            return responses[index++] ?? '{"type":"final","text":"done"}';
        },
        cancel() {},
    } as unknown as Intelligence;
}
