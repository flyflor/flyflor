import { describe, expect, test } from 'bun:test';
import { AgentChatRole } from '@/agent';
import { useContainer } from '@/core';
import type { InferenceEvent } from './types';
import { Inference } from './service';

const messages = [{ role: AgentChatRole.User, content: 'hello' }];

describe('Inference', () => {
    test('normalizes missing and duplicate action request ids for interaction and replay', async () => {
        const inference = useContainer().create(Inference);
        const oversized = 'x'.repeat(600);
        inference.reader = (() => new ReadableStream<InferenceEvent>({
            start(controller) {
                controller.enqueue({ type: 'action_end', index: 0, request: { id: '', name: 'ask', arguments: {} } });
                controller.enqueue({ type: 'action_end', index: 1, request: { id: 'call', name: 'filesystem', arguments: { action: 'read' } } });
                controller.enqueue({ type: 'action_end', index: 2, request: { id: 'call', name: 'filesystem', arguments: { action: 'read' } } });
                controller.enqueue({ type: 'action_end', index: 3, request: { id: oversized, name: 'filesystem', arguments: { action: 'read' } } });
                controller.enqueue({ type: 'action_end', index: 4, request: { id: oversized, name: 'filesystem', arguments: { action: 'read' } } });
                controller.enqueue({ type: 'done', stopReason: 'toolUse' });
                controller.close();
            },
        }).getReader()) as Inference['reader'];

        const result = await inference.runRequest(messages);

        expect(result.actionRequests.slice(0, 3).map((request) => request.id)).toEqual(['action_1', 'call', 'call_2']);
        expect(result.actionRequests[3]?.id).toHaveLength(256);
        expect(result.actionRequests[4]?.id).toHaveLength(256);
        expect(result.actionRequests[4]?.id).not.toBe(result.actionRequests[3]?.id);
    });

    test('cancels its reader when a visible-text consumer fails', async () => {
        const inference = useContainer().create(Inference);
        let cancelled: unknown;
        inference.reader = (() => new ReadableStream<InferenceEvent>({
            start(controller) {
                controller.enqueue({ type: 'text_delta', text: 'chunk' });
            },
            cancel(reason) {
                cancelled = reason;
            },
        }).getReader()) as Inference['reader'];

        await expect(inference.stream(messages, () => { throw Error('consumer failed'); })).rejects.toThrow('consumer failed');

        expect(cancelled).toBeInstanceOf(Error);
        expect((cancelled as Error).message).toBe('consumer failed');
    });
});
