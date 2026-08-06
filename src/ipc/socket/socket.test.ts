import type { Socket } from 'bun';
import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import type { AgentManager } from '@/collective';
import { IPCPacket } from '../packet';
import { IPC_PROTOCOL } from '../types';
import { FSocket } from './socket';
import type { SocketConnectionData } from './connection';

class TestSocket {
    public readonly writes: Buffer[] = [];

    public write(data: Uint8Array): number {
        this.writes.push(Buffer.from(data));
        return data.byteLength;
    }
}

const envelope = (action: string, data: unknown, messageId: string = crypto.randomUUID()) => ({ protocol: IPC_PROTOCOL, messageId, action, data });

describe('FSocket', () => {
    test('requires the Flyflor IPC protocol and routes valid user receipts', async () => {
        const packet = await useContainer().getAsync(IPCPacket);
        const gateway = useContainer().create(FSocket);
        const manager = {
            receive: async (value: unknown) => ({ messageId: (value as { messageId: string }).messageId, state: 'focused', focusId: 'focus_1', revision: 1, queueDepth: 0 }),
            answer: () => undefined,
            cancel: () => undefined,
            on: () => undefined,
        } as unknown as AgentManager;
        gateway.packet = packet;
        gateway.manager = manager;
        const socket = useContainer().create(TestSocket) as unknown as Socket<SocketConnectionData>;
        gateway.open(socket);

        const connection = [...gateway.connections.values()][0]!;
        const open = packet.decode<{ action: string; data: { protocol: string; connectionId: string } }>((socket as unknown as TestSocket).writes[0]!);
        expect(open).toMatchObject({ action: 'open', data: { protocol: IPC_PROTOCOL, connectionId: connection.id } });

        await gateway.data(socket, packet.encode({ action: 'user', data: { text: 'legacy' } }));
        const legacyError = packet.decode<{ action: string; data: { message: string } }>((socket as unknown as TestSocket).writes.at(-1)!);
        expect(legacyError).toMatchObject({ action: 'error', data: { message: 'Unsupported IPC protocol: undefined' } });

        await gateway.data(socket, packet.encode(envelope('user', { speakerId: 'speaker-a', text: 'hello' }, 'm'.repeat(513))));
        const identifierError = packet.decode<{ action: string; data: { message: string } }>((socket as unknown as TestSocket).writes.at(-1)!);
        expect(identifierError).toMatchObject({ action: 'error', data: { message: 'messageId exceeds 512 characters' } });

        await gateway.data(socket, packet.encode(envelope('user', { speakerId: 'speaker-a', text: 'hello' }, 'm1')));
        const receipt = packet.decode<{ action: string; data: { type: string; receipt: { messageId: string } } }>((socket as unknown as TestSocket).writes.at(-1)!);
        expect(receipt).toMatchObject({ action: 'event', data: { type: 'receipt', receipt: { messageId: 'm1' } } });
    });

    test('targets output and disconnects clients independently', async () => {
        const packet = await useContainer().getAsync(IPCPacket);
        const gateway = useContainer().create(FSocket);
        Object.defineProperty(gateway, 'log', { value: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } });
        gateway.packet = packet;
        const disconnected: string[] = [];
        gateway.manager = {
            on: () => undefined,
            disconnect: (connectionId: string) => { disconnected.push(connectionId); },
        } as unknown as AgentManager;
        const first = useContainer().create(TestSocket) as unknown as Socket<SocketConnectionData>;
        const second = useContainer().create(TestSocket) as unknown as Socket<SocketConnectionData>;
        gateway.open(first);
        gateway.open(second);
        const firstConnection = [...gateway.connections.values()][0]!;
        const secondConnection = [...gateway.connections.values()][1]!;
        const deliver = (gateway as unknown as { deliver: (output: unknown) => void }).deliver.bind(gateway);

        deliver({ action: 'agent', data: { chunk: 'private' }, targets: [secondConnection.id] });
        expect((second as unknown as TestSocket).writes).toHaveLength(2);
        expect((first as unknown as TestSocket).writes).toHaveLength(1);

        gateway.close(first);
        expect(gateway.connections.has(firstConnection.id)).toBe(false);
        expect(gateway.connections.has(secondConnection.id)).toBe(true);
        expect(disconnected).toEqual([firstConnection.id]);
    });

    test('isolates an oversized outbound packet as a connection error', async () => {
        const packet = await useContainer().getAsync(IPCPacket);
        const gateway = useContainer().create(FSocket);
        Object.defineProperty(gateway, 'log', { value: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } });
        gateway.packet = packet;
        gateway.manager = { on: () => undefined, disconnect: () => undefined } as unknown as AgentManager;
        const socketValue = useContainer().create(TestSocket);
        const socket = socketValue as unknown as Socket<SocketConnectionData>;
        gateway.open(socket);
        const connection = [...gateway.connections.values()][0]!;
        const deliver = (gateway as unknown as { deliver: (output: unknown) => void }).deliver.bind(gateway);

        expect(() => deliver({ action: 'event', data: { content: 'x'.repeat(4 * 1024 * 1024 + 1) }, targets: [connection.id] })).not.toThrow();

        const error = packet.decode<{ action: string; data: { message: string } }>(socketValue.writes.at(-1)!);
        expect(error).toMatchObject({ action: 'error', data: { message: 'IPC output rejected: Packet body exceeds limit' } });
    });

    test('normalizes answer and cancel payloads and forwards their message ids', async () => {
        const packet = await useContainer().getAsync(IPCPacket);
        const gateway = useContainer().create(FSocket);
        const answers: unknown[][] = [];
        const cancellations: unknown[][] = [];
        gateway.packet = packet;
        gateway.manager = {
            answer: (...args: unknown[]) => {
                answers.push(args);
                return { messageId: args[2], action: 'answer', state: 'accepted' };
            },
            cancel: (...args: unknown[]) => {
                cancellations.push(args);
                return { messageId: args[2], action: 'cancel', state: 'accepted' };
            },
            disconnect: () => undefined,
            on: () => undefined,
        } as unknown as AgentManager;
        const socket = useContainer().create(TestSocket) as unknown as Socket<SocketConnectionData>;
        gateway.open(socket);
        const connection = [...gateway.connections.values()][0]!;

        await gateway.data(socket, packet.encode(envelope('answer', {
            requestId: 'confirm-1',
            focusId: 'focus-1',
            speakerId: 'speaker-a',
            ignored: true,
            response: { approved: true, kind: 'confirm', ignored: true },
        }, 'answer-1')));
        await gateway.data(socket, packet.encode(envelope('cancel', {
            focusId: 'focus-1',
            speakerId: 'speaker-a',
            ignored: true,
        }, 'cancel-1')));

        expect(answers).toEqual([[
            {
                speakerId: 'speaker-a',
                focusId: 'focus-1',
                requestId: 'confirm-1',
                response: { kind: 'confirm', approved: true },
            },
            connection.id,
            'answer-1',
        ]]);
        expect(cancellations).toEqual([[
            { speakerId: 'speaker-a', focusId: 'focus-1' },
            connection.id,
            'cancel-1',
        ]]);
        const receipts = (socket as unknown as TestSocket).writes
            .map((value) => packet.decode<{ action: string; data: { type?: string; receipt?: { messageId: string } } }>(value))
            .filter((value) => value.action === 'event' && value.data.type === 'receipt')
            .map((value) => value.data.receipt?.messageId);
        expect(receipts).toEqual(['answer-1', 'cancel-1']);
    });

    test('preserves packet order across overlapping data callbacks on one connection', async () => {
        const packet = await useContainer().getAsync(IPCPacket);
        const gateway = useContainer().create(FSocket);
        const received: string[] = [];
        let releaseFirst!: () => void;
        let markFirstStarted!: () => void;
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
        gateway.packet = packet;
        gateway.manager = {
            receive: async (value: unknown) => {
                const messageId = (value as { messageId: string }).messageId;
                received.push(messageId);
                if (messageId === 'm1') {
                    markFirstStarted();
                    await firstGate;
                }
                return { messageId, state: 'queued', queueDepth: 0 };
            },
            on: () => undefined,
        } as unknown as AgentManager;
        const socket = useContainer().create(TestSocket) as unknown as Socket<SocketConnectionData>;
        gateway.open(socket);
        const first = gateway.data(socket, Buffer.concat([
            packet.encode(envelope('user', { speakerId: 'speaker-a', text: 'first' }, 'm1')),
            packet.encode(envelope('user', { speakerId: 'speaker-a', text: 'second' }, 'm2')),
        ]));
        await firstStarted;

        const deferredChunk = packet.encode(envelope('user', { speakerId: 'speaker-a', text: 'third' }, 'm3'));
        const overlapping = gateway.data(socket, deferredChunk);
        deferredChunk.fill(0);
        await Bun.sleep(1);
        expect(received).toEqual(['m1']);

        releaseFirst();
        await Promise.all([first, overlapping]);
        expect(received).toEqual(['m1', 'm2', 'm3']);
    });

    test('reports malformed coalesced frames without dropping later valid packets', async () => {
        const packet = await useContainer().getAsync(IPCPacket);
        const gateway = useContainer().create(FSocket);
        const received: string[] = [];
        gateway.packet = packet;
        gateway.manager = {
            receive: async (value: unknown) => {
                const messageId = (value as { messageId: string }).messageId;
                received.push(messageId);
                return { messageId, state: 'focused', focusId: 'focus_1', revision: 1, queueDepth: 0 };
            },
            on: () => undefined,
        } as unknown as AgentManager;
        const socket = useContainer().create(TestSocket) as unknown as Socket<SocketConnectionData>;
        gateway.open(socket);
        const invalidBody = Buffer.from('{invalid json', 'utf8');
        const invalidHeader = Buffer.alloc(8);
        invalidHeader.writeBigUInt64BE(BigInt(invalidBody.byteLength));

        await gateway.data(socket, Buffer.concat([
            invalidHeader,
            invalidBody,
            packet.encode(envelope('unknown', {}, 'bad-action')),
            packet.encode(envelope('user', { speakerId: 'speaker-a', text: 'valid' }, 'm1')),
        ]));

        expect(received).toEqual(['m1']);
        const messages = (socket as unknown as TestSocket).writes
            .map((value) => packet.decode<{ action: string; data: { message?: string } }>(value))
            .filter((value) => value.action === 'error')
            .map((value) => value.data.message);
        expect(messages.some((message) => message?.includes('JSON'))).toBe(true);
        expect(messages).toContain('Unsupported IPC action: unknown');
    });

    test('suppresses deferred writes after a client disconnects', async () => {
        const packet = await useContainer().getAsync(IPCPacket);
        const gateway = useContainer().create(FSocket);
        Object.defineProperty(gateway, 'log', { value: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } });
        let release!: () => void;
        let markStarted!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { markStarted = resolve; });
        gateway.packet = packet;
        gateway.manager = {
            receive: async () => {
                markStarted();
                await gate;
                return { messageId: 'm1', state: 'focused', focusId: 'focus_1', revision: 1, queueDepth: 0 };
            },
            disconnect: () => undefined,
            on: () => undefined,
        } as unknown as AgentManager;
        const socketValue = useContainer().create(TestSocket);
        const socket = socketValue as unknown as Socket<SocketConnectionData>;
        gateway.open(socket);
        const processing = gateway.data(socket, packet.encode(envelope('user', { speakerId: 'speaker-a', text: 'hello' }, 'm1')));
        await started;

        gateway.close(socket);
        release();
        await processing;

        expect(socketValue.writes).toHaveLength(1);
        expect(gateway.connections).toHaveLength(0);
    });
});
