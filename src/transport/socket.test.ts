import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import type { Socket } from 'bun';
import { IPCPacket } from './packet';
import { FSocket, SocketEvent, type SocketConnectionData } from './socket';
import type { Controller } from './controller';

/**
 * EN: RecordedSignal interface declaration.
 * ZH: RecordedSignal interface 声明。
 */
/**
 * EN: PartialSocket class declaration.
 * ZH: PartialSocket class 声明。
 */
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

/**
 * EN: RecordingSynapse class declaration.
 * ZH: RecordingSynapse class 声明。
 */
/**
 * EN: RecordingController class declaration.
 * ZH: RecordingController class 声明。
 */
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

describe('FSocket', () => {
    test('continues partial IPC writes on drain', () => {
        const socket = useContainer().create(FSocket);
        const connection = new PartialSocket();
        const packet = useContainer().create(IPCPacket);
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
        const socket = useContainer().create(FSocket);
        const connection = new PartialSocket();
        const packet = useContainer().create(IPCPacket);
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

    test('reports user packets through the transport callback', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const inputs: string[] = [];
        socket.packet = packet;
        socket.bind({
            input: (text) => { inputs.push(text); },
            answer: () => undefined,
        });
        socket.connection = {} as Socket<SocketConnectionData>;

        await socket.data(socket.connection, packet.encode({ action: SocketEvent.User, data: { text: 'hello' } }));

        expect(inputs).toEqual(['hello']);
    });

    test('reports interaction answers through the transport callback', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const answers: unknown[] = [];
        socket.packet = packet;
        socket.bind({
            input: () => undefined,
            answer: (turnId, id, response) => { answers.push({ turnId, id, response }); },
        });
        socket.connection = {} as Socket<SocketConnectionData>;

        await socket.data(socket.connection, packet.encode({
            action: SocketEvent.Answer,
            data: { turnId: 'turn_1', id: 'ask_1', response: { kind: 'ask', answers: [] } },
        }));

        expect(answers).toEqual([{ turnId: 'turn_1', id: 'ask_1', response: { kind: 'ask', answers: [] } }]);
    });

    test('dispatches non-user packets to controller methods', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const controller = new RecordingController();
        const data = { path: '/tmp/flyflor' };
        socket.packet = packet;
        socket.controller = controller as unknown as Controller;
        socket.connection = {} as Socket<SocketConnectionData>;

        await socket.data(socket.connection, packet.encode({ action: 'cwd', data }));

        expect(controller.cwdCalls).toEqual([data]);
    });
});
