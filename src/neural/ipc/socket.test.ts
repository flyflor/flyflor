import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { Socket } from 'bun';
import { IPCPacket } from './packet';
import { FSocket, SocketEvent, type SocketConnectionData } from './socket';
import type { Controller } from './controller';
import type { Synapse } from '../synapse';

interface RecordedSignal {
    type: string;
    data: unknown;
}

class PartialSocket {
    public chunks: Buffer[];
    public limit: number;
    public blocked: boolean;

    constructor() {
        this.chunks = [];
        this.limit = 5;
        this.blocked = false;
    }

    public write(data: string | Uint8Array): number {
        if (this.blocked) return -1;
        const buffer = Buffer.from(data);
        const written = Math.min(this.limit, buffer.byteLength);
        this.chunks.push(buffer.subarray(0, written));
        return written;
    }
}

class RecordingSynapse {
    public signals: RecordedSignal[];

    constructor() {
        this.signals = [];
    }

    public emit(type: string, data: unknown): void {
        this.signals.push({ type, data });
    }
}

class RecordingController {
    public cwdCalls: unknown[];

    constructor() {
        this.cwdCalls = [];
    }

    public cwd(data: unknown): void {
        this.cwdCalls.push(data);
    }

    public dispatch({ action, data }: { action: string; data: unknown }): void {
        const method = this[action as keyof RecordingController] as unknown as ((arg: unknown) => void) | undefined;
        if (typeof method === 'function') method.call(this, data);
    }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('FSocket', () => {
    test('continues partial IPC writes on drain', () => {
        const socket = new FSocket();
        const connection = new PartialSocket();
        const packet = new IPCPacket();
        const message = { action: 'agent', data: '一段很长的流式输出\nwith newline' };
        socket.packet = packet;
        socket.connection = connection as unknown as Socket<SocketConnectionData>;

        socket.write(message);
        while (Buffer.concat(connection.chunks).byteLength < packet.encode(message).byteLength) {
            void socket.drain();
        }

        const decoded = packet.decode(Buffer.concat(connection.chunks));
        expect(decoded).toEqual(message);
    });

    test('keeps pending output when socket write is backpressured', () => {
        const socket = new FSocket();
        const connection = new PartialSocket();
        const packet = new IPCPacket();
        const message = { action: 'agent', data: 'blocked first write' };
        connection.blocked = true;
        socket.packet = packet;
        socket.connection = connection as unknown as Socket<SocketConnectionData>;

        socket.write(message);
        expect(connection.chunks).toEqual([]);

        connection.blocked = false;
        while (Buffer.concat(connection.chunks).byteLength < packet.encode(message).byteLength) {
            void socket.drain();
        }

        const decoded = packet.decode(Buffer.concat(connection.chunks));
        expect(decoded).toEqual(message);
    });

    test('emits user packets to synapse input', async () => {
        const socket = new FSocket();
        const packet = new IPCPacket();
        const synapse = new RecordingSynapse();
        socket.packet = packet;
        socket.synapse = synapse as unknown as Synapse;

        await socket.data({} as Socket<SocketConnectionData>, packet.encode({ action: SocketEvent.User, data: { text: 'hello' } }));
        await tick();

        expect(synapse.signals).toEqual([{ type: 'input', data: 'hello' }]);
    });

    test('dispatches non-user packets to controller methods', async () => {
        const socket = new FSocket();
        const packet = new IPCPacket();
        const controller = new RecordingController();
        const data = { path: '/tmp/flyflor' };
        socket.packet = packet;
        socket.controller = controller as unknown as Controller;

        await socket.data({} as Socket<SocketConnectionData>, packet.encode({ action: 'cwd', data }));
        await tick();

        expect(controller.cwdCalls).toEqual([data]);
    });
});
