import { afterEach, describe, expect, test } from 'bun:test';
import { AgentChatRole, type AgentMemory, type Intelligence } from '@/agent/brain/intelligence';
import { useContainer } from '@/core';
import type { ToolRegistry } from '@/tools';
import '@/tools/module';
import { Execution } from './service';

describe('Execution', () => {
    test('returns final when the model sends a plain {"type":"final"}', async () => {
        const execution = await testExecution(['{"type":"final","text":"done"}']);

        const result = await execution.run('do the thing', []);

        expect(result.ok).toBe(true);
        expect(result.reason).toBe('final');
        expect(result.text).toBe('done');
        expect(result.toolCalls).toEqual([]);
    });

    test('loops through tool calls and returns the natural final', async () => {
        const execution = await testExecution([
            '{"type":"tool","calls":[{"name":"read","input":{"path":"a.txt"}}]}',
            '{"type":"final","text":"read the file"}',
        ]);

        const result = await execution.run('inspect a.txt', []);

        expect(result.ok).toBe(true);
        expect(result.reason).toBe('final');
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]!.name).toBe('read');
    });

    test('exits on parse-failure after the retry limit', async () => {
        const execution = await testExecution([
            'not json at all',
            'also not json',
            '{"type":"tool","calls":[{]',
            'still broken',
        ]);

        const result = await execution.run('do something', []);

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('parse-failure');
        expect(result.toolCalls).toEqual([]);
    });

    test('returns max-iterations when the loop budget is exhausted', async () => {
        const execution = await testExecution(
            Array.from({ length: 200 }, () => '{"type":"tool","calls":[{"name":"glob","input":{"pattern":"*.ts"}}]}'),
        );

        const result = await execution.run('do something', []);

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('max-iterations');
    });

    test('exits with ask reason when the ask terminal tool runs', async () => {
        const execution = await testExecution([
            '{"type":"tool","calls":[{"name":"ask","input":{"question":"What file?"}}]}',
        ]);

        const result = await execution.run('unspecified task', []);

        expect(result.ok).toBe(true);
        expect(result.reason).toBe('ask');
        expect(result.toolCalls).toHaveLength(1);
    });

    test('exits with confirm reason when the confirm terminal tool runs', async () => {
        const execution = await testExecution([
            '{"type":"tool","calls":[{"name":"confirm","input":{"action":"rm -rf /","reason":"test"}}]}',
        ]);

        const result = await execution.run('destroy everything', []);

        expect(result.ok).toBe(true);
        expect(result.reason).toBe('confirm');
    });
});

async function testExecution(responses: string[]): Promise<Execution> {
    const execution = await useContainer().getAsync(Execution);

    execution.intelligence = fakeIntelligence(responses);
    execution.registry = fakeRegistry();
    execution.memory = { buildMessage: (): AgentMemory[] => [], commit: () => {}, context: [] } as any;

    return execution;
}

function fakeIntelligence(responses: string[]): Intelligence {
    let index = 0;
    return {
        async complete(_: AgentMemory[]): Promise<string> {
            return responses[index++] ?? '{"type":"final","text":"fallback"}';
        },
        cancel() {},
    } as unknown as Intelligence;
}

function fakeRegistry(): ToolRegistry {
    const list = async () => [
        { name: 'read', readOnly: true, terminal: false, description: '', parameters: {}, maxResultChars: 1000 },
        { name: 'glob', readOnly: true, terminal: false, description: '', parameters: {}, maxResultChars: 1000 },
        { name: 'grep', readOnly: true, terminal: false, description: '', parameters: {}, maxResultChars: 1000 },
        { name: 'ask', readOnly: true, terminal: true, description: '', parameters: {}, maxResultChars: 1000 },
        { name: 'confirm', readOnly: true, terminal: true, description: '', parameters: {}, maxResultChars: 1000 },
    ] as any[];
    return {
        list,
        find: async (name: string) => (await list()).find((t) => t.name === name),
        render: async () => '',
        parse: (text: string) => {
            const start = text.indexOf('{');
            if (start === -1) return { type: 'invalid', reason: 'not JSON' };
            let depth = 0;
            for (let i = start; i < text.length; i++) {
                if (text[i] === '{') depth++;
                if (text[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        try {
                            const parsed = JSON.parse(text.slice(start, i + 1));
                            if (parsed.type === 'final' && typeof parsed.text === 'string') return { type: 'final', text: parsed.text };
                            if (parsed.type === 'tool' && Array.isArray(parsed.calls)) {
                                const calls = parsed.calls.filter((c: any) => typeof c.name === 'string').map((c: any) => ({ name: c.name, input: c.input ?? {} }));
                                return { type: 'tool', calls };
                            }
                            return { type: 'invalid', reason: 'unknown shape' };
                        } catch { return { type: 'invalid', reason: 'bad JSON' }; }
                    }
                }
            }
            return { type: 'invalid', reason: 'unbalanced' };
        },
        dispatch: async (call: any) => ({ name: call.name, input: call.input ?? {}, ok: true, result: `result of ${call.name}` }),
    } as unknown as ToolRegistry;
}
