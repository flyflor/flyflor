import { describe, expect, test } from 'bun:test';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';
import { createProtocolStreamState } from '../factory';
import { AgentChatRole } from '@/agent/memory';
import type { IntelligenceEvent, IntelligenceToolDefinition, ProtocolBuildContext } from '../types';

/**
 * Collects events the adapter enqueues so a test can assert the reconstructed tool calls.
 * Only `enqueue` is exercised; the factory owns `close`/`error` in production.
 */
function collector() {
    const events: IntelligenceEvent[] = [];
    const controller = { enqueue: (event: IntelligenceEvent) => events.push(event) } as unknown as ReadableStreamDefaultController<IntelligenceEvent>;
    return { events, controller };
}

function sse(payload: Record<string, unknown>): string {
    return `data: ${JSON.stringify(payload)}`;
}

function chunk(toolCalls: unknown, finishReason?: string): Record<string, unknown> {
    return { choices: [{ delta: { tool_calls: toolCalls }, finish_reason: finishReason ?? null }] };
}

describe('openai chat tool-call accumulator', () => {
    test('reassembles one tool call whose arguments stream across deltas', () => {
        const { events, controller } = collector();
        const state = createProtocolStreamState();
        const lines = [
            sse(chunk([{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '' } }])),
            sse(chunk([{ index: 0, function: { arguments: '{"path":"' } }])),
            sse(chunk([{ index: 0, function: { arguments: 'package.json"}' } }])),
            sse(chunk([], 'tool_calls')),
        ];
        let finished = false;
        for (const line of lines) finished = openAIChatCompletionsAdapter.parseLine(controller, line, state) || finished;

        expect(finished).toBe(true);
        const end = events.find((event) => event.type === 'toolcall_end');
        expect(end).toBeDefined();
        if (end?.type !== 'toolcall_end') throw Error('missing toolcall_end');
        expect(end.toolCall).toEqual({ id: 'call_1', name: 'read_file', arguments: { path: 'package.json' } });
        const done = events.at(-1);
        expect(done).toEqual({ type: 'done', stopReason: 'toolUse' });
    });

    test('routes continuation deltas that carry only the index', () => {
        const { events, controller } = collector();
        const state = createProtocolStreamState();
        // Only the first delta carries id/name; the rest carry index only (the common compatible-provider shape).
        openAIChatCompletionsAdapter.parseLine(controller, sse(chunk([{ index: 0, id: 'c', function: { name: 'codegraph', arguments: '{"que' } }])), state);
        openAIChatCompletionsAdapter.parseLine(controller, sse(chunk([{ index: 0, function: { arguments: 'ry":"x"}' } }])), state);
        const finished = openAIChatCompletionsAdapter.parseLine(controller, sse(chunk([], 'tool_calls')), state);

        expect(finished).toBe(true);
        const end = events.find((event) => event.type === 'toolcall_end');
        if (end?.type !== 'toolcall_end') throw Error('missing toolcall_end');
        expect(end.toolCall).toEqual({ id: 'c', name: 'codegraph', arguments: { query: 'x' } });
    });

    test('reassembles two parallel tool calls by index', () => {
        const { events, controller } = collector();
        const state = createProtocolStreamState();
        openAIChatCompletionsAdapter.parseLine(controller, sse(chunk([
            { index: 0, id: 'a', function: { name: 'read_file', arguments: '{"path":"a"}' } },
            { index: 1, id: 'b', function: { name: 'read_file', arguments: '{"path":"b"}' } },
        ])), state);
        openAIChatCompletionsAdapter.parseLine(controller, sse(chunk([], 'tool_calls')), state);

        const ends = events.filter((event) => event.type === 'toolcall_end');
        expect(ends.length).toBe(2);
        if (ends[0]?.type !== 'toolcall_end' || ends[1]?.type !== 'toolcall_end') throw Error('missing toolcall_end');
        expect(ends[0].toolCall.arguments).toEqual({ path: 'a' });
        expect(ends[1].toolCall.arguments).toEqual({ path: 'b' });
    });

    test('truncated arguments fall back to an empty object instead of throwing', () => {
        const { events, controller } = collector();
        const state = createProtocolStreamState();
        openAIChatCompletionsAdapter.parseLine(controller, sse(chunk([{ index: 0, id: 'a', function: { name: 'read_file', arguments: '{"path":' } }])), state);
        openAIChatCompletionsAdapter.parseLine(controller, sse(chunk([], 'tool_calls')), state);

        const end = events.find((event) => event.type === 'toolcall_end');
        if (end?.type !== 'toolcall_end') throw Error('missing toolcall_end');
        expect(end.toolCall.arguments).toEqual({});
    });

    test('plain text turns emit text deltas then a stop done', () => {
        const { events, controller } = collector();
        const state = createProtocolStreamState();
        openAIChatCompletionsAdapter.parseLine(controller, sse({ choices: [{ delta: { content: 'hello ' }, finish_reason: null }] }), state);
        const finished = openAIChatCompletionsAdapter.parseLine(controller, sse({ choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] }), state);

        expect(finished).toBe(true);
        expect(events.filter((event) => event.type === 'text_delta').map((event) => (event.type === 'text_delta' ? event.text : ''))).toEqual(['hello ', 'world']);
        expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'stop' });
    });
});

describe('openai chat request body', () => {
    function context(messages: ProtocolBuildContext['messages'], tools?: IntelligenceToolDefinition[]): ProtocolBuildContext {
        return { config: {} as never, messages, protocol: {} as never, adapter: openAIChatCompletionsAdapter, model: 'm', maxTokens: 100, tools };
    }

    test('advertises tools as function definitions', () => {
        const tools: IntelligenceToolDefinition[] = [{ name: 'read_file', description: 'Read', parameters: { type: 'object', properties: {} } }];
        const body = openAIChatCompletionsAdapter.body(context([{ role: AgentChatRole.User, content: 'hi' }], tools));
        expect(body.tools).toEqual([{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: {} } } }]);
    });

    test('sends an empty tools param when history carries tool calls but no live tools', () => {
        const body = openAIChatCompletionsAdapter.body(context([
            { role: AgentChatRole.Assistant, content: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: { path: 'x' } }] },
            { role: AgentChatRole.Tool, content: 'file body', toolCallId: 'a', toolName: 'read_file', isError: false },
        ]));
        expect(body.tools).toEqual([]);
    });

    test('replays assistant tool calls and tool results onto the wire', () => {
        const body = openAIChatCompletionsAdapter.body(context([
            { role: AgentChatRole.Assistant, content: 'looking', toolCalls: [{ id: 'a', name: 'read_file', arguments: { path: 'x' } }] },
            { role: AgentChatRole.Tool, content: 'file body', toolCallId: 'a', toolName: 'read_file', isError: false },
        ]));
        const messages = body.messages as Array<Record<string, unknown>>;
        expect(messages[0]).toEqual({
            role: 'assistant',
            content: 'looking',
            tool_calls: [{ id: 'a', type: 'function', function: { name: 'read_file', arguments: '{"path":"x"}' } }],
        });
        expect(messages[1]).toEqual({ role: 'tool', tool_call_id: 'a', content: 'file body' });
    });

    test('replays empty assistant tool-call content as an empty string instead of null', () => {
        const body = openAIChatCompletionsAdapter.body(context([
            { role: AgentChatRole.Assistant, content: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: { path: 'x' } }] },
        ]));
        const messages = body.messages as Array<Record<string, unknown>>;
        expect(messages[0]?.content).toBe('');
    });
});
