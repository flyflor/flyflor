import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentMemory } from '@/agent/types';
import { beforeEach, describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Context, ContextIntent, ContextTurnStatus } from '@/neural/context';

describe('Context', () => {
    let context: Context;

    beforeEach(async () => {
        context = await useContainer().getAsync(Context);
        context.current = undefined;
        context.turns = [];
        context.completed = [];
    });

    test('ingest creates a distilled turn understanding', async () => {
        context.intelligence = {
            completeText: async () => JSON.stringify({
                intent: 'research',
                goal: '修复 IPC JSON 解析错误',
                constraints: ['以后用中文交流'],
                references: [{ type: 'error', value: 'Bad control character in string literal' }],
                knownDone: ['已经加过日志'],
                openQuestions: [],
                shouldInvestigate: true,
            }),
        } as never;

        const understanding = await context.ingest({ content: '解析错误: Bad control character in string literal' });

        expect(understanding.intent).toBe(ContextIntent.Research);
        expect(context.current?.goal).toBe('修复 IPC JSON 解析错误');
        expect(context.current?.references).toContainEqual({ type: 'error', value: 'Bad control character in string literal' });
        expect(context.turns).toHaveLength(1);
        expect(context.turns[0]?.understanding.userText).toBe('解析错误: Bad control character in string literal');
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Working);
    });

    test('settle creates a completed summary and stores it on the active turn', async () => {
        context.load({
            userText: '实现计划',
            intent: ContextIntent.Research,
            goal: '实现 context/memory 重构',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        context.intelligence = {
            completeText: async () => JSON.stringify({
                goal: '实现 context/memory 重构',
                result: '已将 synapse.context 接入 agent.memory',
                changedFiles: ['src/neural/synapse.ts'],
                decisions: ['不引入额外 context pipeline'],
                evidence: ['agent.memory.completed 写入完成态'],
                remaining: [],
            }),
        } as never;

        const summary = await context.settle({
            user: '实现计划',
            assistant: '已完成',
            completed: true,
            evidence: ['agent.memory.completed 写入完成态'],
        });

        expect(summary?.result).toContain('synapse.context');
        expect(context.completed).toHaveLength(1);
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Completed);
        expect(context.turns[0]?.summary?.result).toContain('synapse.context');
        expect(context.turns[0]?.assistantText).toBe('已完成');
    });

    test('settle with completed false does not create a summary', async () => {
        context.load({
            userText: '实现计划',
            intent: ContextIntent.Research,
            goal: '确认实现方式',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });

        const summary = await context.settle({
            user: '实现计划',
            assistant: '需要确认',
            completed: false,
        });

        expect(summary).toBeUndefined();
        expect(context.completed).toHaveLength(0);
        expect(context.turns[0]?.summary).toBeUndefined();
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Working);
    });

    test('records pause state and writes a derived debug snapshot', () => {
        const cwd = process.cwd();
        const directory = mkdtempSync(join(tmpdir(), 'flyflor-context-'));
        process.chdir(directory);
        try {
            context.load({
                userText: '继续优化 flyflor-cli 的 context',
                intent: ContextIntent.Research,
                goal: '优化 flyflor-cli context',
                constraints: ['turn 只存在于 context'],
                references: [{ type: 'path', value: '../flyflor-cli' }],
                knownDone: [],
                openQuestions: [],
                shouldInvestigate: true,
            });

            context.pause({ kind: 'ask', prompt: '继续优化哪个项目？' });
            const snapshot = readFileSync(`${directory}/cache.context.md`, 'utf8');

            expect(context.turns[0]?.paused).toBe(true);
            expect(context.turns[0]?.pauseKind).toBe('ask');
            expect(context.turns[0]?.pausePrompt).toBe('继续优化哪个项目？');
            expect(context.turns[0]?.scope?.project).toBe('flyflor-cli');
            expect(context.turns[0]?.scope?.anchor).toContain('flyflor-cli');
            expect(snapshot).toContain('Derived debug view only');
            expect(snapshot).toContain('继续优化哪个项目？');
            expect(snapshot).toContain('flyflor-cli');
            expect(snapshot).not.toContain('tool_call_id');
        } finally {
            process.chdir(cwd);
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('uses the latest explicit project anchor when the user corrects scope', () => {
        context.load({
            userText: '不对，之前是让 agent 研究 flyflor-cli，不是 flyflor',
            intent: ContextIntent.Research,
            goal: '纠正项目 scope',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });

        expect(context.turns[0]?.scope?.project).toBe('flyflor-cli');
    });

    test('ingest clears previous pause after using recent context for the next turn', async () => {
        context.load({
            userText: '需要选择项目',
            intent: ContextIntent.Research,
            goal: '确认项目',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: ['继续哪个项目？'],
            shouldInvestigate: true,
        });
        context.pause({ kind: 'ask', prompt: '继续哪个项目？' });
        context.intelligence = {
            completeText: async (messages: AgentMemory[]) => {
                expect(messages[1]?.content).toContain('继续哪个项目？');
                return JSON.stringify({
                    intent: 'research',
                    goal: '继续优化 flyflor-cli',
                    constraints: [],
                    references: [{ type: 'text', value: 'flyflor-cli' }],
                    knownDone: [],
                    openQuestions: [],
                    shouldInvestigate: true,
                });
            },
        } as never;

        await context.ingest({ content: 'flyflor-cli' });

        expect(context.turns).toHaveLength(2);
        expect(context.turns[0]?.paused).toBe(false);
        expect(context.turns[0]?.pausePrompt).toBeUndefined();
        expect(context.turns[1]?.understanding.goal).toBe('继续优化 flyflor-cli');
        expect(context.turns[1]?.scope?.project).toBe('flyflor-cli');
    });

    test('recent exposes only turn understanding and summaries', async () => {
        context.load({
            userText: '调查工具层',
            intent: ContextIntent.Research,
            goal: '调查工具层',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        context.intelligence = {
            completeText: async () => JSON.stringify({
                goal: '调查工具层',
                result: '工具层已经分离',
                changedFiles: ['src/plugins/execute.ts'],
                decisions: ['动作层不依赖 memory'],
                evidence: ['service.test.ts 通过'],
                remaining: [],
            }),
        } as never;
        await context.settle({ user: '调查工具层', assistant: '工具层已经分离', completed: true });

        const recent = context.recent();

        expect(recent).toHaveLength(1);
        expect(recent[0]?.understanding.goal).toBe('调查工具层');
        expect(recent[0]?.summary?.result).toBe('工具层已经分离');
        expect(JSON.stringify(recent[0])).not.toContain('transcript');
        expect(JSON.stringify(recent[0])).not.toContain('tool_call_id');
    });
});
