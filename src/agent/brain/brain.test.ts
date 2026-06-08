import { describe, expect, test } from 'bun:test';
import { FileService, useContainer } from '@/core';
import { Brain } from './brain';
import { AgentChatRole, type AgentChatMessage, type Intelligence, type IntelligenceTurn } from './intelligence';
import { SoulSection } from '../types';
import type { BrainInvestigationResult, Investigation } from './investigation';

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

        const prepared = await brain.prepareTurn('hi');
        await expect(collect(brain.streamTurn(prepared.messages))).resolves.toBe('hello');
        brain.commitTurn('hi', 'hello');

        expect(prepared.messages).toEqual([
            {
                role: AgentChatRole.System,
                content: '<SOUL>\nfollow the constitution\n</SOUL>\n\n<MEMORY>\nremember the user\n</MEMORY>',
            },
            {
                role: AgentChatRole.User,
                content: investigatedUserContent('hi'),
            },
        ]);
        expect(seenTurns).toEqual([prepared.messages]);
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

        const prepared = await brain.prepareTurn('hi');

        await expect(collect(brain.streamTurn(prepared.messages))).rejects.toThrow('provider failed');
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

        const prepared = await brain.prepareTurn('hi');
        const turn = brain.streamTurn(prepared.messages);
        await expect(turn.next()).resolves.toMatchObject({ done: false, value: 'partial' });
        await turn.return(undefined);

        expect(cancelled).toBe(true);
        expect(brain.context).toEqual([]);
    });

    test('keeps transformer as a compatibility wrapper around prepared streaming turns', async () => {
        const brain = await brainWithPrompt({
            [SoulSection.Soul]: 'follow the constitution',
        });
        const seenTurns: AgentChatMessage[][] = [];
        setProviderStream(brain, (messages: AgentChatMessage[]) => {
            seenTurns.push(messages);
            return streamFromText('o', 'k');
        });

        await expect(collect(brain.transformer('hi'))).resolves.toBe('ok');

        expect(seenTurns).toHaveLength(1);
        expect(brain.context).toEqual([
            { role: AgentChatRole.User, content: 'hi' },
            { role: AgentChatRole.Assistant, content: 'ok' },
        ]);
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
    setInvestigation(brain);
    return brain;
}

function setInvestigation(brain: Brain, result: BrainInvestigationResult = defaultInvestigation()): void {
    brain.investigation = {
        investigate: async () => result,
    } as unknown as Investigation;
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

function defaultInvestigation(): BrainInvestigationResult {
    return {
        state: {
            explicit_requests: ['hi'],
            implicit_goals: ['greeting'],
            constraints: [],
            unknowns: [],
            hypotheses: [{
                goal: 'greet the assistant',
                supporting_evidence: ['short greeting'],
                missing_evidence: [],
                confidence: 0.9,
            }],
            evidence: ['user said hi'],
            information_needed: [],
            next_question: '',
            confidence: 0.9,
        },
        observations: [],
    };
}

function investigatedUserContent(content: string): string {
    return JSON.stringify({
        user_message: content,
        investigation: defaultInvestigation().state,
        tool_observations: [],
    }, null, 4);
}
