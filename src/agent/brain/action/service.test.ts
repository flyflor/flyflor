import { describe, expect, test } from 'bun:test';
import type { FAgentProfileConfiguration } from '@/configuration';
import type { FAgentHost } from '@/core';
import { useContainer } from '@/core';
import { ToolComponent } from '@/plugins';
import { Action } from './service';

const profile: FAgentProfileConfiguration = {
    name: 'flyflor', role: 'leader', description: 'leader', capabilities: [], actionScope: 'full',
    model: 'model', provider: 'provider', contextLength: 1, maxTokens: 1,
};

const control = (signal = new AbortController().signal) => ({
    focusId: 'focus_1', revision: 1, agentId: 'flyflor', signal,
});

describe('Action', () => {
    test('rejects specialist side effects before tool execution', async () => {
        let runs = 0;
        const action = useContainer().create(Action, profile, { emit: () => undefined } satisfies FAgentHost);
        action.tools = {
            cwd: async () => false,
            allowed: async () => false,
            requiresConfirm: async () => false,
            run: async () => { runs += 1; return { ok: true, name: 'filesystem' }; },
        } as unknown as ToolComponent;

        const result = await action.run({ id: 'write', name: 'filesystem', arguments: { action: 'write' } }, 'read', control());

        expect(result.result.error?.code).toBe('AGENT_ACTION_SCOPE');
        expect(runs).toBe(0);
    });

    test('honors abort and owner confirmation gates', async () => {
        let runs = 0;
        const host: FAgentHost = { emit: () => undefined, interact: async () => ({ kind: 'confirm', approved: false }) };
        const action = useContainer().create(Action, profile, host);
        action.tools = {
            cwd: async () => false,
            allowed: async () => true,
            requiresConfirm: async () => true,
            run: async () => { runs += 1; return { ok: true, name: 'shell' }; },
        } as unknown as ToolComponent;
        const aborted = new AbortController();
        aborted.abort(Error('obsolete'));

        await expect(action.run({ id: 'shell', name: 'shell', arguments: {} }, 'full', control(aborted.signal))).rejects.toThrow('obsolete');
        expect((await action.run({ id: 'shell', name: 'shell', arguments: {} }, 'full', control())).result.error?.code).toBe('TOOL_REJECTED');
        expect(runs).toBe(0);
    });

    test('keeps raw tool buffers out of shared observations', async () => {
        const action = useContainer().create(Action, profile, { emit: () => undefined } satisfies FAgentHost);
        action.tools = {
            cwd: async () => false,
            allowed: async () => true,
            requiresConfirm: async () => false,
            run: async () => ({ ok: true, name: 'filesystem', data: { action: 'read', path: '/tmp/a', bytes: 100, content: 'secret raw file content' } }),
        } as unknown as ToolComponent;

        const observation = await action.run({ id: 'read', name: 'filesystem', arguments: { action: 'read' } }, 'full', control());

        expect(observation.evidence).toContain('/tmp/a');
        expect(observation.evidence).not.toContain('secret raw file content');
    });

    test('rechecks revision immediately before the resolved tool atom starts', async () => {
        const controller = new AbortController();
        const events: unknown[] = [];
        let runs = 0;
        const action = useContainer().create(Action, profile, { emit: (_type, data) => { events.push(data); } } satisfies FAgentHost);
        action.tools = {
            cwd: async () => false,
            allowed: async () => true,
            requiresConfirm: async () => false,
            run: async (_request: unknown, start?: () => void) => {
                controller.abort(Error('revised during tool resolution'));
                start?.();
                runs += 1;
                return { ok: true, name: 'filesystem' };
            },
        } as unknown as ToolComponent;

        await expect(action.run({ id: 'read', name: 'filesystem', arguments: { action: 'read' } }, 'full', control(controller.signal))).rejects.toThrow('revised during tool resolution');
        expect(runs).toBe(0);
        expect(events).toEqual([]);
    });

    test('returns an unknown leader tool as an observation instead of failing the focus', async () => {
        const action = useContainer().create(Action, profile, { emit: () => undefined } satisfies FAgentHost);
        action.tools = await useContainer().getAsync(ToolComponent);

        const observation = await action.run({ id: 'unknown', name: 'not-a-tool', arguments: {} }, 'full', control());

        expect(observation.result).toEqual({
            ok: false,
            name: 'not-a-tool',
            error: { code: 'TOOL_ERROR', message: 'Unknown tool: not-a-tool' },
        });
        expect(observation.evidence).toBe('not-a-tool error: Unknown tool: not-a-tool');
    });
});
