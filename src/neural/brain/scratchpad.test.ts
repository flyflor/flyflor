import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { useContainer } from '@/core';
import { AgentProfile } from '@/population/types';
import { ChatRole, Scratchpad, SoulSection, type MindMessage } from './scratchpad';
import { SituationModel } from '@/neural/situation';
import { Workspace } from '@/neural/workspace';

/**
 * EN: Scratchpad is no longer a pure projection of Workspace.turns. It is a private
 * Scratchpad seeded by an explicit Workspace brief. The test verifies
 * that brief-derived notes (not the raw conversation) surface in the next model
 * call and that no tool replay buffers leak in.
 * ZH: Scratchpad 不再是 Workspace.turns 的纯投影。它是由显式 Workspace 简报初始化的
 * 私有临时笔记。本测试验证简报衍生的笔记（而非原始对话）出现在下一次模型
 * 调用中，且没有工具回放缓冲区泄漏。
 */
describe('Scratchpad', () => {
    test('surfaces brief-derived notes without leaking tool or transcript buffers', async () => {
        const scratchpad = await useContainer().getAsync(Scratchpad);
        const workspace = new Workspace(new SituationModel());
        workspace.prompt = { section: () => 'system placeholder' } as never;
        workspace.intelligence = {
            completeText: async () => JSON.stringify({
                intent: 'research',
                goal: 'ship the cortex changes',
                cwd: '/tmp/flyflor',
                constraints: [],
                refs: [],
                done: [],
                open: [],
                investigate: true,
            }),
        } as never;

        const userMessage = '实现计划';
        const turn = await workspace.ingest({ text: userMessage, speakerId: 'test' });

        // EN: Seed the private Scratchpad from the Workspace brief.
        // ZH: 用 Workspace 简报初始化私有临时笔记。
        scratchpad.ingestBrief(workspace.brief());

        const messages = scratchpad.buildMessages();
        const system = messages[0]?.content ?? '';
        const user = messages[1]?.content ?? '';
        const role: MindMessage['role'] = ChatRole.User;

        expect(role).toBe(ChatRole.User);
        expect(system).not.toContain('<agent_memory>');
        expect(turn.goal).toContain('cortex');
        expect(turn.intent).toBe('research');
        expect(user).toContain('cortex');
        expect(user).toContain('research');
        expect(user).not.toContain(userMessage);
        expect(user).not.toContain('toolCalls');
        expect(user).not.toContain('tool_call_id');
        expect(user).not.toContain('toolName');
        expect(user).not.toContain('"role":"tool"');
        expect(user).not.toContain('pending');
        expect(user).not.toContain('transcript');
    });

    test('renders persona sections and brief notes from the configured package', async () => {
        const scratchpad = await useContainer().getAsync(Scratchpad);
        let renderedSections: string[] = [];
        scratchpad.config = { persona: { promptSections: [SoulSection.Soul, SoulSection.User, SoulSection.Extension] } } as never;
        scratchpad.prompt = {
            render: (input: { sections: string[] }) => {
                renderedSections = input.sections;
                return 'system persona';
            },
        } as never;

        scratchpad.ingestBrief({
            turnId: 'turn_1',
            intent: 'research',
            goal: 'inspect one slice',
            constraints: [],
            refs: [],
            done: [],
            open: [],
            workspace: [],
        });

        const messages = scratchpad.buildMessages();

        expect(renderedSections).toEqual([SoulSection.Soul, SoulSection.Extension]);
        expect(messages[0]?.content).toBe('system persona');
        expect(messages[1]?.content).toBe(`-[brief] turn turn_1: status=unknown, intent=research, goal=inspect one slice, constraints=[]`);
    });

    test('seeds salvage outcome when the current turn is suspended', async () => {
        const scratchpad = await useContainer().getAsync(Scratchpad);
        scratchpad.config = { persona: { promptSections: [SoulSection.Soul] } } as never;
        scratchpad.prompt = { render: () => 'system' } as never;

        scratchpad.ingestBrief({
            turnId: 'turn_7',
            intent: 'research',
            goal: 'ship interrupt recovery',
            constraints: ['keep partial progress'],
            refs: [{ type: 'path', value: 'src/neural/brain/scratchpad.ts' }],
            done: ['mapped the gap'],
            open: ['wire denser brief'],
            workspace: [{
                turnId: 'turn_7',
                status: 'suspended',
                intent: 'research',
                goal: 'ship interrupt recovery',
                constraints: ['keep partial progress'],
                refs: [{ type: 'path', value: 'src/neural/brain/scratchpad.ts' }],
                done: ['mapped the gap'],
                open: ['wire denser brief'],
                outcome: {
                    goal: 'ship interrupt recovery',
                    result: 'partial progress before preemption',
                    changedFiles: [],
                    decisions: ['keep suspended slot'],
                    evidence: ['interrupt compacted outcome'],
                    remaining: ['finish denser brief seed'],
                    createdAt: 1,
                },
            }],
        });

        const notes = scratchpad.notes.map((note) => note.content).join('\n');
        expect(notes).toContain('status=suspended');
        expect(notes).toContain('partial progress before preemption');
        expect(notes).toContain('finish denser brief seed');
        expect(notes).toContain('keep suspended slot');
        expect(notes).toContain('current turn_7');
    });

    test('loads the persona package from the carried profile instead of the config default', async () => {
        const scratchpad = await useContainer().getAsync(Scratchpad, undefined, new AgentProfile('tester', './prompts/agent'));

        expect(scratchpad.profile?.id).toBe('tester');
        expect(scratchpad.prompt.path.endsWith(join('prompts', 'agent'))).toBe(true);
    });

    test('seeds a bounded situation projection into private notes', async () => {
        const scratchpad = await useContainer().getAsync(Scratchpad);
        scratchpad.config = { persona: { promptSections: [SoulSection.Soul] } } as never;
        scratchpad.prompt = { render: () => 'system' } as never;

        scratchpad.ingestBrief({
            turnId: 'turn_2',
            intent: 'reply',
            goal: 'answer follow-up',
            constraints: [],
            refs: [],
            done: [],
            open: [],
            workspace: [{
                turnId: 'turn_2',
                status: 'working',
                intent: 'reply',
                goal: 'answer follow-up',
                constraints: [],
                refs: [],
                done: [],
                open: [],
            }],
            situation: [
                { speakerId: 'conn_1', intent: 'research', goal: 'older goal', result: 'older result', remaining: ['leftover-a', 'leftover-b'] },
                { speakerId: 'conn_2', intent: 'reply', goal: 'peer goal', result: 'peer result', remaining: [] },
            ],
        });

        const notes = scratchpad.notes.map((note) => note.content).join('\n');
        expect(notes).toContain('situation conn_1');
        expect(notes).toContain('older goal');
        expect(notes).toContain('older result');
        expect(notes).toContain('leftover-a');
        expect(notes).toContain('situation conn_2');
        expect(notes).toContain('status=working');
    });
});
