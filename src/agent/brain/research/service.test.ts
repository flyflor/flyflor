import { describe, expect, test } from 'bun:test';
import type { FAgentProfileConfiguration } from '@/config';
import { AgentChatRole, Memory } from '@/agent/memory';
import { CallosumSignalType } from '@/agent/brain/callosum';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { ResearchStopReason } from '@/agent/research.types';
import { Provide, Scope, useContainer } from '@/core';
import { Research } from './service';

class FakeIntelligence extends Intelligence {
    public completions: string[] = [];

    public streamed = '';

    public override async completeText(): Promise<string> {
        const next = this.completions.shift();
        if (next === undefined) throw Error('Fake completion missing');
        return next;
    }

    public override async stream(_messages: unknown[], next: (chunk: string) => void): Promise<void> {
        next(this.streamed);
    }
}

@Provide()
class ResearchTestHarness {
    @Scope()
    public research!: Research;

    @Scope()
    public memory!: Memory;

    @Scope()
    public intelligence!: FakeIntelligence;
}

async function useResearch() {
    const agentConfig: FAgentProfileConfiguration = { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 };
    const harness = await useContainer().getAsync(ResearchTestHarness, agentConfig);
    harness.memory.prompt = { config: undefined, data: {} } as never;
    harness.research.prompt = { data: { RESEARCH: { data: 'research prompt' } } } as never;
    harness.research.memory = harness.memory;
    harness.research.intelligence = harness.intelligence;
    harness.research.readFile.boundary = await useContainer().getAsync((await import('@/plugins/tools')).ToolBoundary);
    harness.research.codegraph.boundary = harness.research.readFile.boundary;
    return harness;
}

describe('Research', () => {
    test('ask interrupts the turn and stores pending research', async () => {
        const harness = await useResearch();
        const signals: unknown[] = [];
        harness.research.subscribe((signal) => signals.push(signal));
        harness.intelligence.completions.push(JSON.stringify({
            action: 'ask',
            summary: 'Need scope clarification.',
            question: 'Which scope?',
            options: [
                { id: 'local', label: 'Local', description: 'Use local files.', recommended: true },
            ],
        }));

        const result = await harness.research.run([{ role: AgentChatRole.User, content: 'research tools' }], 'research tools');

        expect(result.reason).toBe(ResearchStopReason.NeedsUser);
        expect(harness.memory.pendingResearch?.awaiting).toBe('ask');
        expect(signals).toContainEqual({
            type: CallosumSignalType.Clarification,
            chunk: 'Which scope?',
            data: {
                kind: 'ask',
                question: 'Which scope?',
                options: [
                    { id: 'local', label: 'Local', description: 'Use local files.', recommended: true },
                ],
                other: true,
            },
        });
    });

    test('synthesize clears pending research and streams a final answer', async () => {
        const harness = await useResearch();
        const chunks: string[] = [];
        harness.memory.pendingResearch = {
            originalUserContent: 'research tools',
            summary: 'Need scope clarification.',
            evidence: [],
            awaiting: 'confirm',
            clarification: { kind: 'confirm', question: 'Proceed?', default: true, recommended: true },
        };
        harness.research.subscribe((signal) => {
            if (signal.type === CallosumSignalType.Reply) chunks.push(signal.chunk);
        });
        harness.intelligence.completions.push(JSON.stringify({
            action: 'synthesize',
            summary: 'Ready to answer.',
            answerPlan: 'Answer directly.',
        }));
        harness.intelligence.streamed = 'final answer';

        const result = await harness.research.run([{ role: AgentChatRole.User, content: 'yes' }], 'yes');

        expect(result.reason).toBe(ResearchStopReason.Answered);
        expect(harness.memory.pendingResearch).toBeUndefined();
        expect(chunks).toEqual(['final answer']);
    });
});
