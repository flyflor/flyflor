import type { Socket } from 'bun';
import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { IPCPacket } from '../packet';
import { IPC_PROTOCOL } from '../types';
import { MAX_CONNECTION_BUFFER_BYTES, SocketConnection, type SocketConnectionData } from './connection';

class TestSocket {
    public readonly writes: Buffer[] = [];
    public blocked = false;
    public ended = false;

    public write(data: Uint8Array): number {
        this.writes.push(Buffer.from(data));
        return this.blocked ? 0 : data.byteLength;
    }

    public end(): number {
        this.ended = true;
        return 0;
    }
}

describe('SocketConnection', () => {
    test('keeps decoder state isolated per connection', async () => {
        const codec = await useContainer().getAsync(IPCPacket);
        const left = useContainer().create(SocketConnection, useContainer().create(TestSocket) as unknown as Socket<SocketConnectionData>, 'left', codec);
        const right = useContainer().create(SocketConnection, useContainer().create(TestSocket) as unknown as Socket<SocketConnectionData>, 'right', codec);
        const leftPacket = codec.encode({ protocol: IPC_PROTOCOL, messageId: 'left', action: 'user', data: { speakerId: 'a', text: '你' } });
        const rightPacket = codec.encode({ protocol: IPC_PROTOCOL, messageId: 'right', action: 'user', data: { speakerId: 'b', text: '好' } });

        expect(left.read(leftPacket.subarray(0, 5))).toEqual([]);
        expect(right.read(rightPacket).map((item) => item.messageId)).toEqual(['right']);
        expect(left.read(leftPacket.subarray(5)).map((item) => item.messageId)).toEqual(['left']);
    });

    test('retains output while blocked and flushes it on drain', async () => {
        const codec = await useContainer().getAsync(IPCPacket);
        const socket = useContainer().create(TestSocket);
        socket.blocked = true;
        const connection = useContainer().create(SocketConnection, socket as unknown as Socket<SocketConnectionData>, 'one', codec);

        connection.write({ protocol: IPC_PROTOCOL, messageId: 'out', action: 'event', data: { ok: true } });
        socket.blocked = false;
        connection.drain();

        expect(socket.writes).toHaveLength(2);
        expect(socket.writes[1]).toEqual(socket.writes[0]);
        expect(codec.decode<{ messageId: string }>(socket.writes[1]!)).toMatchObject({ messageId: 'out' });
    });

    test('disconnects only the slow connection when its output queue exceeds the cap', async () => {
        const codec = await useContainer().getAsync(IPCPacket);
        const socket = useContainer().create(TestSocket);
        const healthySocket = useContainer().create(TestSocket);
        socket.blocked = true;
        const connection = useContainer().create(SocketConnection, socket as unknown as Socket<SocketConnectionData>, 'slow', codec);
        const healthy = useContainer().create(SocketConnection, healthySocket as unknown as Socket<SocketConnectionData>, 'healthy', codec);
        const content = 'x'.repeat(Math.floor(MAX_CONNECTION_BUFFER_BYTES / 3));

        connection.write({ protocol: IPC_PROTOCOL, messageId: 'one', action: 'event', data: { content } });
        connection.write({ protocol: IPC_PROTOCOL, messageId: 'two', action: 'event', data: { content } });

        expect(() => connection.write({ protocol: IPC_PROTOCOL, messageId: 'three', action: 'event', data: { content } })).toThrow('Connection output buffer exceeds');
        healthy.write({ protocol: IPC_PROTOCOL, messageId: 'healthy', action: 'event', data: { ok: true } });
        expect(socket.ended).toBe(true);
        expect(healthySocket.ended).toBe(false);
        expect(healthySocket.writes).toHaveLength(1);
    });

    test('disconnects an input flood while another packet is still dispatching', async () => {
        const codec = await useContainer().getAsync(IPCPacket);
        const socket = useContainer().create(TestSocket);
        const connection = useContainer().create(SocketConnection, socket as unknown as Socket<SocketConnectionData>, 'flood', codec);
        const text = 'x'.repeat(Math.floor(MAX_CONNECTION_BUFFER_BYTES / 3));
        const packet = codec.encode({ protocol: IPC_PROTOCOL, messageId: 'flood', action: 'user', data: { speakerId: 'speaker', text } });
        let markStarted!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => { markStarted = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const dispatch = async () => {
            markStarted();
            await gate;
        };
        const first = connection.receive(packet, dispatch, () => undefined);
        await started;
        const second = connection.receive(packet, dispatch, () => undefined);

        await expect(connection.receive(packet, dispatch, () => undefined)).rejects.toThrow('Connection input buffer exceeds');
        release();
        await Promise.all([first, second]);
        expect(socket.ended).toBe(true);
    });
});
