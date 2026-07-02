import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { AgentChatRole, Memory, type AgentMemory } from './memory';
import { Context } from '@/agent/context';

describe('Memory', () => {
    test('keeps AgentMemory pure and renders summaries instead of transcripts or action replay', async () => {
        const memory = await useContainer().getAsync(Memory, { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 });
        const context = await useContainer().getAsync(Context);
        context.current = undefined;
        context.turns = [];
        context.completed = [];
        context.load({
            userText: '实现计划',
            intent: 'research',
            goal: '实现 synapse.context + agent.memory',
            workingDirectory: '/tmp/flyflor',
            constraints: ['不要过度抽象'],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        const summary = {
            goal: '修复 IPC',
            result: 'socket 背压写队列已完成',
            changedFiles: ['src/neural/ipc/socket.ts'],
            decisions: ['packet 保持 8-byte header'],
            evidence: ['socket.test.ts 通过'],
            remaining: ['补集成验证'],
            createdAt: Date.now(),
        };
        const turn = context.turns[0];
        if (turn) {
            turn.paused = true;
            turn.pauseKind = 'confirm';
            turn.pausePrompt = '允许写文件？';
            turn.assistantText = '已完成';
            turn.summary = summary;
        }
        context.completed = [summary];

        const messages = memory.buildMessage();
        const system = messages[0]?.content ?? '';
        const user = messages[1]?.content ?? '';
        const role: AgentMemory['role'] = AgentChatRole.User;

        expect(role).toBe(AgentChatRole.User);
        // 摘要不再以 <agent_memory> XML 进 system,而是随 contextBlock 进 user JSON。
        expect(system).not.toContain('<agent_memory>');
        expect(user).toContain('实现 synapse.context + agent.memory');
        expect(user).toContain('socket 背压写队列已完成');
        expect(user).toContain('packet 保持 8-byte header');
        expect(user).toContain('socket.test.ts 通过');
        const payload = JSON.parse(user) as {
            current?: {
                goal?: string;
                user?: string;
                workingDirectory?: string;
            };
            recentContext?: Array<{
                status?: string;
                user?: string;
                assistantText?: string;
                paused?: boolean;
                pauseKind?: string;
                pausePrompt?: string;
                summary?: { result?: string };
                goal?: string;
                workingDirectory?: string;
            }>;
        };

        expect(payload.current).toMatchObject({
            goal: '实现 synapse.context + agent.memory',
            user: '实现计划',
            workingDirectory: '/tmp/flyflor',
        });
        expect(payload.recentContext?.[0]).toMatchObject({
            status: 'working',
            user: '实现计划',
            paused: true,
            pauseKind: 'confirm',
            pausePrompt: '允许写文件？',
            summary: {
                result: 'socket 背压写队列已完成',
            },
        });
        expect(JSON.stringify(payload.recentContext)).not.toContain('"goal":"实现 synapse.context + agent.memory"');
        expect(JSON.stringify(payload.recentContext)).not.toContain('"workingDirectory":"/tmp/flyflor"');
        expect(user).toContain('允许写文件？');
        expect(user).toContain('补集成验证');
        expect(user).not.toContain('toolCalls');
        expect(user).not.toContain('tool_call_id');
        expect(user).not.toContain('toolName');
        expect(user).not.toContain('"role":"tool"');
        expect(user).not.toContain('pending');
        expect(user).not.toContain('transcript');
    });
});
