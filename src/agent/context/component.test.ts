import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from './component';

describe('Context', () => {
    let originalCwd: string;
    let root: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        root = mkdtempSync(join(tmpdir(), 'flyflor-context-'));
        process.chdir(root);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        rmSync(root, { recursive: true, force: true });
    });

    test('writes flat turn state to cache.context.md', async () => {
        const context = new Context();
        context.prompt = { section: () => 'settle prompt' } as never;
        context.intelligence = {
            completeText: async () => JSON.stringify({
                goal: '完成 context 瘦身',
                result: 'turn 已拍平',
                changedFiles: ['src/agent/context/component.ts'],
                decisions: ['Context owns turns'],
                evidence: ['context test'],
                remaining: ['none'],
            }),
        } as never;

        context.load({
            userText: '简化 Context',
            intent: 'research',
            goal: '完成 context 瘦身',
            workingDirectory: '/tmp/flyflor',
            constraints: ['不要新增 session'],
            references: [{ type: 'path', value: 'src/agent/context' }],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        context.pause({ kind: 'confirm', prompt: '继续？' });
        context.resume();
        await context.settle({ user: '简化 Context', assistant: '已完成', completed: true });

        const cache = readFileSync(join(root, 'cache.context.md'), 'utf-8');

        expect(context.turns[0]).toMatchObject({
            userText: '简化 Context',
            intent: 'research',
            goal: '完成 context 瘦身',
            status: 'completed',
            assistantText: '已完成',
        });
        expect(JSON.stringify(context.turns[0])).not.toContain('understanding');
        expect(cache).toContain('"status": "completed"');
        expect(cache).toContain('"assistant": "已完成"');
        expect(cache).toContain('"result": "turn 已拍平"');
        expect(cache).not.toContain('"understanding"');
        expect(cache).not.toContain('"role":"tool"');
    });
});
