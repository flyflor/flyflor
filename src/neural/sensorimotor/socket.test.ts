import 'reflect-metadata';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { Socket } from 'bun';
import { useContainer } from '@/core';
import { IPCPacket } from './packet';
import { FSocket, SocketEvent } from './socket';
import { Connection, type ConnectionData } from './connection';
import type { Controller } from './controller';
import type { PopulationRouter } from '@/population/types';

/**
 * EN: Mock socket that records backpressure and partial writes.
 * ZH: 记录背压和部分写入的 mock socket。
 */
class PartialSocket {
    public chunks: Buffer[] = [];
    public limit = 5;
    public blocked = false;

    public write(data: string | Uint8Array): number {
        if (this.blocked) return -1;
        const buffer = Buffer.from(data);
        const written = Math.min(this.limit, buffer.byteLength);
        this.chunks.push(buffer.subarray(0, written));
        return written;
    }
}

interface CapturedStimulus {
    speakerId: string;
    text: string;
}

class RecordingRouter implements PopulationRouter {
    public stimuli: CapturedStimulus[] = [];
    public forgotten: string[] = [];
    public answers: unknown[] = [];
    public routes: Array<{ speakerId: string; agentId: string }> = [];
    public knownAgents = new Set<string>();

    public perceive(input: { speakerId: string; text: string }): void {
        this.stimuli.push(input);
    }

    public forget(speakerId: string): void {
        this.forgotten.push(speakerId);
    }

    public answer(turnId: string, id: string, response: unknown): void {
        this.answers.push({ turnId, id, response });
    }

    public route(speakerId: string, agentId: string): boolean {
        this.routes.push({ speakerId, agentId });
        return this.knownAgents.has(agentId);
    }
}

class RecordingController {
    public cwdCalls: unknown[] = [];

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
    let socket: FSocket;
    let packet: IPCPacket;
    let router: RecordingRouter;
    let controller: RecordingController;

    beforeEach(async () => {
        socket = new FSocket();
        packet = new IPCPacket();
        router = new RecordingRouter();
        controller = new RecordingController();
        socket.packet = packet;
        socket.attachRouter(router);
        socket.controller = controller as unknown as Controller;
        socket.path = '/tmp/flyflor.test.sock';
    });

    let connectionCounter = 0;
    function openConnection(mock = new PartialSocket()): { mock: PartialSocket; connection: Connection; speakerId: string } {
        connectionCounter += 1;
        const speakerId = `conn_${connectionCounter}`;
        const connection = useContainer().create(Connection, mock as unknown as Socket<ConnectionData>, speakerId);
        connection.packet = packet;
        const access = socket as unknown as { connections: Map<Socket<ConnectionData>, Connection>; bySpeaker: Map<string, Connection> };
        access.connections.set(mock as unknown as Socket<ConnectionData>, connection);
        access.bySpeaker.set(speakerId, connection);
        return { mock, connection, speakerId };
    }

    test('continues partial IPC writes on drain', () => {
        const { mock, speakerId } = openConnection();
        const message = { action: 'agent', data: '一段很长的流式输出\nwith newline' };

        socket.write(speakerId, message);
        while (Buffer.concat(mock.chunks).byteLength < packet.encode(message).byteLength) {
            void socket.drain(mock as unknown as Socket<ConnectionData>);
        }

        const decoded = packet.decode(Buffer.concat(mock.chunks));
        expect(decoded).toEqual(message);
    });

    test('keeps pending output when socket write is backpressured', () => {
        const { mock, speakerId } = openConnection();
        const message = { action: 'agent', data: 'blocked first write' };
        mock.blocked = true;

        socket.write(speakerId, message);
        expect(mock.chunks).toEqual([]);

        mock.blocked = false;
        while (Buffer.concat(mock.chunks).byteLength < packet.encode(message).byteLength) {
            void socket.drain(mock as unknown as Socket<ConnectionData>);
        }

        const decoded = packet.decode(Buffer.concat(mock.chunks));
        expect(decoded).toEqual(message);
    });

    test('hands user packets to the population router as stimuli', async () => {
        const { connection } = openConnection();

        await socket.data(connection.socket, packet.encode({ action: SocketEvent.User, data: { text: 'hello' } }));
        await tick();

        expect(router.stimuli).toEqual([{ speakerId: connection.speakerId, text: 'hello' }]);
    });

    test('hands answer packets to the population router', async () => {
        const { connection } = openConnection();
        const answer = { turnId: 'turn_1', id: 'ask_1', response: { kind: 'ask', answers: [{ question: 'Pick?', answer: 'a' }] } };

        await socket.data(connection.socket, packet.encode({ action: SocketEvent.Answer, data: answer }));
        await tick();

        expect(router.answers).toEqual([answer]);
    });

    test('continues after malformed coalesced packets', async () => {
        const { connection } = openConnection();
        const malformed = packet.encode({ action: SocketEvent.User, data: { nope: true } });
        const valid = packet.encode({ action: SocketEvent.User, data: { text: 'after malformed' } });

        await expect(socket.data(connection.socket, Buffer.concat([malformed, valid]))).resolves.toBeUndefined();

        expect(router.stimuli).toEqual([{ speakerId: connection.speakerId, text: 'after malformed' }]);
    });

    test('contains async controller rejection from malformed packets', async () => {
        const { connection } = openConnection();
        socket.controller = {
            cwd: async () => { throw Error('bad cwd'); },
        } as unknown as Controller;

        await expect(socket.data(connection.socket, packet.encode({ action: 'cwd', data: {} }))).resolves.toBeUndefined();
    });

    test('dispatches non-user packets to controller methods', async () => {
        const { connection } = openConnection();
        const data = { path: '/tmp/flyflor' };

        await socket.data(connection.socket, packet.encode({ action: 'cwd', data }));
        await tick();

        expect(controller.cwdCalls).toEqual([data]);
    });

    test('keeps each connection on its own packet buffer', async () => {
        const { connection: a } = openConnection();
        const { connection: b } = openConnection();

        const first = packet.encode({ action: SocketEvent.User, data: { text: 'a first' } }).subarray(0, 6);
        const rest = packet.encode({ action: SocketEvent.User, data: { text: 'a first' } }).subarray(6);

        await socket.data(a.socket, first);
        await socket.data(b.socket, packet.encode({ action: SocketEvent.User, data: { text: 'b first' } }));
        await socket.data(a.socket, rest);
        await tick();

        expect(router.stimuli).toEqual([
            { speakerId: b.speakerId, text: 'b first' },
            { speakerId: a.speakerId, text: 'a first' },
        ]);
    });

    test('acknowledges a route rebind for a known agent', async () => {
        const { mock, connection } = openConnection();
        mock.limit = 1024;
        router.knownAgents.add('planner');

        await socket.data(connection.socket, packet.encode({ action: SocketEvent.Route, data: { agent: 'planner' } }));
        await tick();

        expect(router.routes).toEqual([{ speakerId: connection.speakerId, agentId: 'planner' }]);
        const written = packet.decode(Buffer.concat(mock.chunks));
        expect(written).toEqual({ action: SocketEvent.Route, data: { agent: 'planner', ok: true } });
    });

    test('rejects a route rebind for an unknown agent', async () => {
        const { mock, connection } = openConnection();
        mock.limit = 1024;

        await socket.data(connection.socket, packet.encode({ action: SocketEvent.Route, data: { agent: 'ghost' } }));
        await tick();

        const written = packet.decode(Buffer.concat(mock.chunks));
        expect(written).toEqual({ action: SocketEvent.Route, data: { agent: 'ghost', ok: false } });
    });

    test('forgets a speaker and drops its connection on close', async () => {
        const { connection } = openConnection();
        await socket.close(connection.socket);

        expect(router.forgotten).toEqual([connection.speakerId]);
        const access = socket as unknown as { connections: Map<Socket<ConnectionData>, Connection>; bySpeaker: Map<string, Connection> };
        expect(access.connections.has(connection.socket as never)).toBe(false);
        expect(access.bySpeaker.has(connection.speakerId)).toBe(false);
    });
});
