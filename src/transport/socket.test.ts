import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import type { Socket } from 'bun';
import { IPCPacket } from './packet';
import { FSocket, SocketEvent, type SocketConnectionData } from './socket';
import type { Controller } from './controller';

/**
 * ZH: RecordedSignal interface 声明。
 * EN: RecordedSignal interface declaration.
 */
/**
 * ZH: PartialSocket class 声明。
 * EN: PartialSocket class declaration.
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

/** ZH: 打开一个测试连接并移除初始 open packet。 EN: Opens one test connection and removes its initial open packet. */
async function connect(socket: FSocket, packet: IPCPacket, connection = new PartialSocket()): Promise<{ connection: PartialSocket; live: Socket<SocketConnectionData> }> {
    const limit = connection.limit;
    const blocked = connection.blocked;
    connection.limit = Number.MAX_SAFE_INTEGER;
    connection.blocked = false;
    socket.packet = packet;
    const live = connection as unknown as Socket<SocketConnectionData>;
    await socket.open(live);
    connection.chunks = [];
    connection.limit = limit;
    connection.blocked = blocked;
    return { connection, live };
}

/**
 * ZH: RecordingSynapse class 声明。
 * EN: RecordingSynapse class declaration.
 */
/**
 * ZH: RecordingController class 声明。
 * EN: RecordingController class declaration.
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
    test('rejects output without a live connection', () => {
        const socket = useContainer().create(FSocket);
        socket.packet = useContainer().create(IPCPacket);

        expect(() => socket.write({ action: 'agent', data: 'unconnected' })).toThrow('connection is unavailable');
    });

    test('continues partial IPC writes on drain', async () => {
        const socket = useContainer().create(FSocket);
        const connection = new PartialSocket();
        const packet = useContainer().create(IPCPacket);
        const message = { action: 'agent', data: '一段很长的流式输出\nwith newline' };
        const { live } = await connect(socket, packet, connection);

        socket.write(message);
        while (Buffer.concat(connection.chunks).byteLength < packet.encode(message).byteLength) {
            await socket.drain(live);
        }

        const decoded = packet.decode(Buffer.concat(connection.chunks));
        expect(decoded).toEqual(message);
    });

    test('keeps pending output when socket write is backpressured', async () => {
        const socket = useContainer().create(FSocket);
        const connection = new PartialSocket();
        const packet = useContainer().create(IPCPacket);
        const message = { action: 'agent', data: 'blocked first write' };
        const { live } = await connect(socket, packet, connection);
        connection.blocked = true;

        socket.write(message);
        expect(connection.chunks).toEqual([]);

        connection.blocked = false;
        while (Buffer.concat(connection.chunks).byteLength < packet.encode(message).byteLength) {
            await socket.drain(live);
        }

        const decoded = packet.decode(Buffer.concat(connection.chunks));
        expect(decoded).toEqual(message);
    });

    test('reports user packets through the transport callback', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const inputs: string[] = [];
        const { live } = await connect(socket, packet);
        await socket.bind({
            connected: () => undefined,
            input: (text) => { inputs.push(text); },
            answer: () => undefined,
        });
        await socket.data(live, packet.encode({ action: SocketEvent.User, data: { text: 'hello' } }));

        expect(inputs).toEqual(['hello']);
    });

    test('reports interaction answers through the transport callback', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const answers: unknown[] = [];
        const { live } = await connect(socket, packet);
        await socket.bind({
            connected: () => undefined,
            input: () => undefined,
            answer: (turnId, id, response) => { answers.push({ turnId, id, response }); },
        });
        await socket.data(live, packet.encode({
            action: SocketEvent.Answer,
            data: { turnId: 'turn_1', id: 'ask_1', response: { kind: 'ask', answers: [] } },
        }));

        expect(answers).toEqual([{ turnId: 'turn_1', id: 'ask_1', response: { kind: 'ask', answers: [] } }]);
    });

    test('awaits input and answer callback completion', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const { live } = await connect(socket, packet);
        let releaseInput!: () => void;
        let releaseAnswer!: () => void;
        let inputFinished = false;
        let answerFinished = false;
        const inputGate = new Promise<void>((resolve) => { releaseInput = resolve; });
        const answerGate = new Promise<void>((resolve) => { releaseAnswer = resolve; });
        await socket.bind({
            connected: () => undefined,
            input: async () => {
                await inputGate;
                inputFinished = true;
            },
            answer: async () => {
                await answerGate;
                answerFinished = true;
            },
        });

        const input = socket.data(live, packet.encode({ action: SocketEvent.User, data: { text: 'wait' } }));
        await Promise.resolve();
        expect(inputFinished).toBe(false);
        releaseInput();
        await input;
        expect(inputFinished).toBe(true);

        const answer = socket.data(live, packet.encode({ action: SocketEvent.Answer, data: { turnId: 'turn_1', id: 'ask_1', response: {} } }));
        await Promise.resolve();
        expect(answerFinished).toBe(false);
        releaseAnswer();
        await answer;
        expect(answerFinished).toBe(true);
    });

    test('dispatches non-user packets to controller methods', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const controller = new RecordingController();
        const data = { path: '/tmp/flyflor' };
        const { live } = await connect(socket, packet);
        socket.controller = controller as unknown as Controller;

        await socket.data(live, packet.encode({ action: 'cwd', data }));

        expect(controller.cwdCalls).toEqual([data]);
    });

    test('awaits connected after open and preserves open-before-replay order', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const connection = new PartialSocket();
        connection.limit = Number.MAX_SAFE_INTEGER;
        let connected = 0;
        socket.packet = packet;
        await socket.bind({
            connected: async () => {
                await Promise.resolve();
                connected += 1;
                socket.write({ action: 'ask', data: { id: 'ask_1' } });
                socket.write({ action: 'pause', data: { id: 'ask_1' } });
            },
            input: () => undefined,
            answer: () => undefined,
        });

        await socket.open(connection as unknown as Socket<SocketConnectionData>);

        const decoder = useContainer().create(IPCPacket);
        const actions = decoder.read(Buffer.concat(connection.chunks)).map((frame) => decoder.decode<{ action: string }>(frame).action);
        expect(connected).toBe(1);
        expect(actions).toEqual(['open', 'ask', 'pause']);
    });

    test('notifies callbacks when binding follows an existing connection', async () => {
        const socket = useContainer().create(FSocket);
        const connection = new PartialSocket();
        connection.limit = Number.MAX_SAFE_INTEGER;
        socket.packet = useContainer().create(IPCPacket);
        await socket.open(connection as unknown as Socket<SocketConnectionData>);
        expect(connection.chunks).toEqual([]);
        let connected = 0;

        await socket.bind({
            connected: () => { connected += 1; },
            input: () => undefined,
            answer: () => undefined,
        });

        expect(connected).toBe(1);
        const decoder = useContainer().create(IPCPacket);
        expect(decoder.read(Buffer.concat(connection.chunks)).map((frame) => decoder.decode<{ action: string }>(frame).action)).toEqual(['open']);
    });

    test('rejects invalid decoded packet roots and actions', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const { live } = await connect(socket, packet);

        await expect(socket.data(live, packet.encode(null))).rejects.toThrow('Invalid IPC packet root');
        await expect(socket.data(live, packet.encode([]))).rejects.toThrow('Invalid IPC packet root');
        await expect(socket.data(live, packet.encode({ data: true }))).rejects.toThrow('Invalid IPC packet root');
        await expect(socket.data(live, packet.encode({ action: '', data: true }))).rejects.toThrow('Invalid IPC packet root');
        await expect(socket.data(live, packet.encode({ action: 'cwd' }))).rejects.toThrow('Invalid IPC packet root');
    });

    test('rejects non-string or empty user text without coercion', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const { live } = await connect(socket, packet);
        await socket.bind({
            connected: () => undefined,
            input: () => undefined,
            answer: () => undefined,
        });

        await expect(socket.data(live, packet.encode({ action: SocketEvent.User, data: { text: 42 } }))).rejects.toThrow('Invalid user IPC packet');
        await expect(socket.data(live, packet.encode({ action: SocketEvent.User, data: { text: '' } }))).rejects.toThrow('Invalid user IPC packet');
        await expect(socket.data(live, packet.encode({ action: SocketEvent.User, data: null }))).rejects.toThrow('Invalid user IPC packet');
        await expect(socket.data(live, packet.encode({ action: SocketEvent.User, data: [] }))).rejects.toThrow('Invalid user IPC packet');
    });

    test('rejects incomplete answer correlation data', async () => {
        const socket = useContainer().create(FSocket);
        const packet = useContainer().create(IPCPacket);
        const { live } = await connect(socket, packet);

        await expect(socket.data(live, packet.encode({ action: SocketEvent.Answer, data: { turnId: '', id: 'ask_1', response: {} } }))).rejects.toThrow('Invalid interaction IPC packet');
        await expect(socket.data(live, packet.encode({ action: SocketEvent.Answer, data: { turnId: 'turn_1', id: '', response: {} } }))).rejects.toThrow('Invalid interaction IPC packet');
        await expect(socket.data(live, packet.encode({ action: SocketEvent.Answer, data: { turnId: 'turn_1', id: 'ask_1' } }))).rejects.toThrow('Invalid interaction IPC packet');
    });
});
