import { describe, expect, test } from 'bun:test';
import { Agent } from '@/agent/agent';
import { Memory } from '@/agent/memory';
import type { AgentBus, CompleteSignal, NeuralSignal } from '@/agent/types';
import { Observable, useContainer } from '@/core';
import type { Message, ToolCall, ToolDefinition } from '@/model';
import { PromptService } from '@/prompt';
import type { ToolRunResult } from '@/tool';
import { Investigation } from './service';
import type { InvestigationOutput, InvestigationRequest, InvestigationSignal } from './types';

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
    cwd: '/tmp/semantic',
    root: true,
};

interface HarnessOptions {
    filesystemContent?: string;
    shellStdout?: string;
    shellStderr?: string;
    pressure?: boolean[];
    summary?: string;
}

/** ZH: 使用确定性边界构造一张持久 Investigation 网络。 EN: Builds one persistent Investigation network with deterministic boundaries. */
function harness(responses: Array<{ text: string; toolCalls: ToolCall[] }>, confirm = true, options: HarnessOptions = {}) {
    const signals: NeuralSignal[] = [];
    const calls: ToolCall[] = [];
    const seen: Message[][] = [];
    const summarySeen: Message[][] = [];
    let lists = 0;
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
    const agent = useContainer().create(Agent, profile, bus);
    const investigation = useContainer().create(Investigation, agent);
    investigation.circuit = useContainer().create(Observable) as Observable<InvestigationSignal, InvestigationOutput>;
    investigation.prompt = useContainer().create(PromptService, 'prompts/investigation/RUN.md') as PromptService<string, string>;
    investigation.summary = useContainer().create(PromptService, 'prompts/investigation/SUMMARY.md') as PromptService<string, string>;
    investigation.memory = useContainer().create(Memory, agent);
    investigation.memory.prompt = useContainer().create(PromptService, 'prompts/memory') as PromptService;
    investigation.tools = {
        list: () => {
            lists += 1;
            return [{ name: 'filesystem', description: 'filesystem', parameters: {} }] as ToolDefinition[];
        },
        cwd: (name: string) => name === 'filesystem',
        requiresConfirm: (call: ToolCall) => call.name === 'filesystem' && call.arguments.action === 'write',
        run: async (call: ToolCall): Promise<ToolRunResult> => {
            calls.push(call);
            if (call.name === 'ask') return { name: 'ask', data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] }, effects: [{ type: 'ask' }] };
            if (call.name === 'task') return { name: 'task', data: { tasks: [{ agent: 'worker', goal: 'inspect child' }] }, effects: [{ type: 'task' }] };
            if (call.name === 'filesystem') {
                const content = options.filesystemContent ?? 'file body';
                return { name: call.name, data: { action: call.arguments.action, path: '/tmp/demo.ts', content, bytes: Buffer.byteLength(content), truncated: false }, effects: [{ type: 'read', path: '/tmp/demo.ts' }] };
            }
            if (call.name === 'shell') {
                return { name: call.name, data: { action: 'shell', cwd: '/tmp/semantic', command: 'inspect', args: [], exitCode: 0, stdout: options.shellStdout ?? '', stderr: options.shellStderr ?? '', timedOut: false }, effects: [{ type: 'execute' }] };
            }
            throw Error(`Unexpected test tool: ${call.name}`);
        },
        observe: (result: ToolRunResult): string => {
            const data = result.data as Record<string, unknown>;
            if (result.name === 'filesystem') {
                return `filesystem: action=${String(data.action ?? '')}; path=${String(data.path ?? '')}; bytes=${String(data.bytes ?? '')}; truncated=${String(data.truncated === true)}`;
            }
            if (result.name === 'shell') {
                const stdoutBytes = typeof data.stdout === 'string' ? Buffer.byteLength(data.stdout) : 0;
                const stderrBytes = typeof data.stderr === 'string' ? Buffer.byteLength(data.stderr) : 0;
                return `shell: command=${String(data.command ?? '')}; cwd=${String(data.cwd ?? '')}; exit=${String(data.exitCode ?? '')}; timedOut=${String(data.timedOut === true)}; stdoutBytes=${stdoutBytes}; stderrBytes=${stderrBytes}`;
            }
            throw Error(`Unexpected observation tool: ${result.name}`);
        },
    } as never;
    let index = 0;
    let pressureIndex = 0;
    investigation.model = {
        needsSummary: () => options.pressure?.[pressureIndex++] ?? false,
        completeText: async (summaryMessages: Message[]) => {
            summarySeen.push(summaryMessages.map((message) => ({ ...message } as Message)));
            return options.summary ?? 'Goal: inspect. Next: continue.';
        },
        streamRun: async (messages: Message[], _tools: ToolDefinition[] | undefined, onText: (chunk: string) => void | Promise<void>) => {
            seen.push(messages.map((message) => ({ ...message } as Message)));
            const response = responses[index++]!;
            if (response.toolCalls.length === 0) await onText(response.text);
            return { ...response, reasoning: '' };
        },
    } as never;
    investigation.init();
    return { investigation, signals, calls, seen, summarySeen, lists: () => lists };
}

const messages = [{ role: 'user', content: 'inspect' }] as Message[];

describe('Investigation', () => {
    test('streams and returns pure Complete without steps or pause state', async () => {
        const { investigation, signals } = harness([{ text: 'answer', toolCalls: [] }]);

        const complete = await investigation.run(messages, request);

        expect(complete).toEqual({ type: 'complete', id: 'turn_1', turnId: 'turn_1', agent: 'flyflor', answer: 'answer', evidence: [] });
        expect(signals).toContainEqual({ type: 'reply', turnId: 'turn_1', agent: 'flyflor', chunk: 'answer' });
    });

    test('keeps full direct and delegated results out of Memory and Complete evidence', async () => {
        const { investigation, calls, seen, lists } = harness([
            { text: '', toolCalls: [{ id: 'read_1', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: '', toolCalls: [{ id: 'shell_1', name: 'shell', arguments: { command: 'inspect' } }] },
            { text: '', toolCalls: [{ id: 'task_1', name: 'task', arguments: { tasks: [] } }] },
            { text: 'done', toolCalls: [] },
        ], true, {
            filesystemContent: 'PRIVATE_FILE_CONTENT',
            shellStdout: 'PRIVATE_STDOUT',
            shellStderr: 'PRIVATE_STDERR',
        });

        const complete = await investigation.run(messages, request);

        expect(calls[0]?.arguments.cwd).toBe('/tmp/semantic');
        expect(lists()).toBe(1);
        expect(complete.evidence).toHaveLength(3);
        expect(seen.at(-1)?.filter((message) => message.role === 'tool')).toHaveLength(3);
        expect(investigation.memory.snapshot().filter((note) => note.source === 'observation')).toHaveLength(3);
        const compact = JSON.stringify({ evidence: complete.evidence, memory: investigation.memory.snapshot() });
        expect(compact).not.toContain('PRIVATE_FILE_CONTENT');
        expect(compact).not.toContain('PRIVATE_STDOUT');
        expect(compact).not.toContain('PRIVATE_STDERR');
        expect(compact).not.toContain('worker fact');
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

    test('projects Ask answers and Task Completes only at the orchestration layer', async () => {
        const { investigation, signals } = harness([
            { text: '', toolCalls: [{ id: 'ask_1', name: 'ask', arguments: { questions: [] } }] },
            { text: '', toolCalls: [{ id: 'task_1', name: 'task', arguments: { tasks: [] } }] },
            { text: 'done', toolCalls: [] },
        ]);

        const complete = await investigation.run(messages, request);

        expect(complete.evidence).toEqual([
            'ask: answers=1; effects=ask',
            'task: completes=1; agents=worker; effects=task',
        ]);
        expect(signals.map((signal) => signal.type)).toContain('ask');
        expect(signals.map((signal) => signal.type)).toContain('task');
    });

    test('bounds one tool replay with UTF-8-safe head and tail omission evidence', async () => {
        const content = `HEAD_MARKER_${'界'.repeat(30000)}_TAIL_MARKER`;
        const { investigation, seen } = harness([
            { text: '', toolCalls: [{ id: 'read_large', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: 'checked', toolCalls: [] },
        ], true, { filesystemContent: content });

        const complete = await investigation.run(messages, request);
        const replay = JSON.stringify(seen[1]);

        expect(replay).toContain('HEAD_MARKER');
        expect(replay).toContain('TAIL_MARKER');
        expect(replay).toContain('bytes omitted');
        expect(Buffer.byteLength(replay)).toBeLessThan(Buffer.byteLength(content));
        expect(JSON.stringify(complete.evidence)).not.toContain('HEAD_MARKER');
        expect(JSON.stringify(investigation.memory.snapshot())).not.toContain('TAIL_MARKER');
    });

    test('summarizes pressured replay before the next ordinary model sample', async () => {
        const rawHistory = `RAW_REPLAY_${'x'.repeat(70000)}`;
        const { investigation, seen, summarySeen } = harness([
            { text: '', toolCalls: [{ id: 'read_pressure', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: 'done after summary', toolCalls: [] },
        ], true, {
            filesystemContent: rawHistory,
            pressure: [true],
            summary: 'Confirmed the target. The file was inspected. Next: verify and complete.',
        });

        const complete = await investigation.run(messages, request);
        const summarizedRequest = JSON.stringify(seen[1]);

        expect(complete.answer).toBe('done after summary');
        expect(summarySeen).toHaveLength(1);
        expect(JSON.stringify(summarySeen[0])).toContain('RAW_REPLAY_');
        expect(summarizedRequest).toContain('inspect');
        expect(summarizedRequest).toContain('Confirmed the target');
        expect(summarizedRequest).toContain('Next: verify and complete');
        expect(summarizedRequest).not.toContain('RAW_REPLAY_');
    });
});
