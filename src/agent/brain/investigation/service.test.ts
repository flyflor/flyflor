import { describe, expect, test } from 'bun:test';
import { Memory } from '@/agent/memory';
import { AgentChatRole, type AgentBus, type CompleteSignal, type NeuralSignal } from '@/agent/types';
import { Observable, useContainer } from '@/core';
import type { Message, ToolCall, ToolDefinition } from '@/model';
import { PromptService } from '@/prompt';
import type { ToolRunResult } from '@/tool';
import { Investigation } from './service';
import type { InvestigationRequest, InvestigationSignal } from './types';

const profile = {
    name: 'flyflor',
    model: 'model',
    provider: 'provider',
    contextLength: 1024,
    maxTokens: 256,
    promptPackage: '.config/agents/flyflor',
    promptSections: ['SOUL'],
};

const request: InvestigationRequest = {
    id: 'turn_1',
    turnId: 'turn_1',
    goal: 'inspect',
    context: { turnId: 'turn_1', input: 'inspect', goal: 'inspect', constraints: [], references: [], cwd: '/tmp/semantic', recent: [] },
    delegation: true,
    visible: true,
};

/** EN: Builds one persistent Investigation network with deterministic boundaries. ZH: 使用确定性边界构造一张持久 Investigation 网络。 */
function harness(responses: Array<{ text: string; toolCalls: ToolCall[] }>, confirm = true) {
    const signals: NeuralSignal[] = [];
    const calls: ToolCall[] = [];
    const seen: Message[][] = [];
    const bus: AgentBus = {
        fire: async (signal) => {
            signals.push(signal);
            if (signal.type === 'ask') return { kind: 'ask', answers: [{ question: 'Pick?', answer: 'a' }] } as never;
            if (signal.type === 'confirm') return { kind: 'confirm', approved: confirm } as never;
            if (signal.type === 'task') {
                return [{ type: 'complete', id: `${signal.id}:1`, turnId: signal.turnId, agent: 'worker', answer: 'worker fact', evidence: ['worker evidence'] }] as never;
            }
            return undefined as never;
        },
    };
    const investigation = useContainer().create(Investigation, profile, bus);
    investigation.circuit = useContainer().create(Observable<InvestigationSignal>, 'investigation-test');
    investigation.prompt = useContainer().create(PromptService, 'prompts/investigation/RUN.md') as PromptService<string, string>;
    investigation.memory = useContainer().create(Memory, profile, bus);
    investigation.memory.prompt = useContainer().create(PromptService, 'prompts/memory') as PromptService;
    investigation.tools = {
        list: async () => [{ name: 'filesystem', description: 'filesystem', parameters: {} }] as ToolDefinition[],
        cwd: async (name: string) => name === 'filesystem',
        requiresConfirm: async (call: ToolCall) => call.name === 'filesystem' && call.arguments.action === 'write',
        run: async (call: ToolCall): Promise<ToolRunResult> => {
            calls.push(call);
            if (call.name === 'ask') return { ok: true, name: 'ask', data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } };
            if (call.name === 'task') return { ok: true, name: 'task', data: { tasks: [{ agent: 'worker', goal: 'inspect child' }] } };
            return { ok: true, name: call.name, data: { action: call.arguments.action, path: '/tmp/demo.ts' } };
        },
    } as never;
    let index = 0;
    investigation.model = {
        streamRun: async (messages: Message[], _tools: ToolDefinition[] | undefined, onText: (chunk: string) => void | Promise<void>) => {
            seen.push(messages.map((message) => ({ ...message } as Message)));
            const response = responses[index++]!;
            if (response.toolCalls.length === 0) await onText(response.text);
            return { ...response, reasoning: '', stopReason: 'stop' };
        },
    } as never;
    investigation.init();
    return { investigation, signals, calls, seen };
}

const messages = [{ role: AgentChatRole.User, content: 'inspect' }] as Message[];

describe('Investigation', () => {
    test('streams and returns pure Complete without steps or pause state', async () => {
        const { investigation, signals } = harness([{ text: 'answer', toolCalls: [] }]);

        const complete = await investigation.run(messages, request);

        expect(complete).toEqual({ type: 'complete', id: 'turn_1', turnId: 'turn_1', agent: 'flyflor', answer: 'answer', evidence: [] });
        expect(signals).toContainEqual({ type: 'reply', turnId: 'turn_1', agent: 'flyflor', chunk: 'answer' });
    });

    test('replays direct actions, Ask, and Task only inside this investigation', async () => {
        const { investigation, calls, seen } = harness([
            { text: '', toolCalls: [{ id: 'read_1', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: '', toolCalls: [{ id: 'ask_1', name: 'ask', arguments: { questions: [] } }] },
            { text: '', toolCalls: [{ id: 'task_1', name: 'task', arguments: { tasks: [] } }] },
            { text: 'done', toolCalls: [] },
        ]);

        const complete = await investigation.run(messages, request);

        expect(calls[0]?.arguments.cwd).toBe('/tmp/semantic');
        expect(complete.evidence).toHaveLength(3);
        expect(seen.at(-1)?.filter((message) => message.role === 'tool')).toHaveLength(3);
        expect(investigation.memory.snapshot().filter((note) => note.source === 'observation')).toHaveLength(3);
    });

    test('treats rejected confirmation as explicit non-execution', async () => {
        const { investigation, calls, seen } = harness([
            { text: '', toolCalls: [{ id: 'write_1', name: 'filesystem', arguments: { action: 'write', path: 'a' } }] },
            { text: 'not written', toolCalls: [] },
        ], false);

        const complete: CompleteSignal = await investigation.run(messages, request);

        expect(complete.answer).toBe('not written');
        expect(calls).toEqual([]);
        expect(JSON.stringify(seen.at(-1))).toContain('executed');
    });
});
