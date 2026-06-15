import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useContainer } from '@/core';
import { configureLogger, LoggerLevel } from '@/core/logger';
import { PACKET_LENGTH_HEADER_BYTES, PACKET_TEXT_ENCODING, PacketService, SocketEvent, type SocketPacket } from '@/neural/packet';
import type { Synapse } from '@/neural/synapse';
import type { Socket } from 'bun';
import { FSocket, type SocketConnectionData } from './socket';

interface CapturedSocket {
    socket: Socket<SocketConnectionData>;
    writes: Buffer[];
}

let tempPaths: string[] = [];

afterEach(() => {
    configureLogger({
        consoleEnabled: true,
        path: './.logs/flyflor.log',
        colorEnabled: true,
        level: LoggerLevel.Debug,
        inspectDepth: 6,
    });
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

async function useSocketHandler(options?: {
    onNext?: (packet: SocketPacket, stream: ReturnType<typeof useAgentStream>) => Promise<void> | void;
}) {
    const logPath = mkdtempSync(join(tmpdir(), 'flyflor-socket-'));
    tempPaths.push(logPath);
    configureLogger({
        consoleEnabled: false,
        path: join(logPath, 'socket.log'),
        colorEnabled: false,
        level: LoggerLevel.Debug,
    });

    const handler = useContainer().create(FSocket) as FSocket;
    const packet = await useContainer().getAsync(PacketService);
    const calls: SocketPacket[] = [];
    const stream = useAgentStream();

    handler.packet = packet;
    handler.synapse = {
        agent: stream.agent,
        next: async (value: SocketPacket) => {
            calls.push(value);
            await options?.onNext?.(value, stream);
        },
    } as unknown as Synapse;

    return { handler, packet, calls, stream };
}

function useCapturedSocket(): CapturedSocket {
    const writes: Buffer[] = [];
    const socket = {
        data: {},
        write: (data: Buffer) => {
            writes.push(Buffer.from(data));
            return data.byteLength;
        },
    } as unknown as Socket<SocketConnectionData>;

    return { socket, writes };
}

function useAgentStream() {
    const subscribers: Array<(value: unknown) => void> = [];
    const agent = {
        subscribe: (subscriber: (value: unknown) => void) => {
            subscribers.push(subscriber);
            return {
                unsubscribe: () => {
                    const index = subscribers.indexOf(subscriber);
                    if (index >= 0) subscribers.splice(index, 1);
                },
            };
        },
    };
    return {
        agent,
        emit: (value: unknown) => {
            for (const subscriber of [...subscribers]) subscriber(value);
        },
        count: () => subscribers.length,
    };
}

function decodeWrites(packet: PacketService, writes: Buffer[]): SocketPacket<unknown>[] {
    const connection = {};
    const packets: SocketPacket<unknown>[] = [];
    for (const write of writes) {
        packets.push(...packet.decode<SocketPacket<unknown>>(connection, write).packets);
    }
    return packets;
}

function frameFromJson(content: string): Buffer {
    const body = Buffer.from(content, PACKET_TEXT_ENCODING);
    const header = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
    header.writeBigUInt64BE(BigInt(body.byteLength), 0);
    return Buffer.concat([header, body]);
}

describe('FSocket', () => {
    test('open sends the handshake without subscribing the socket to global agent output', async () => {
        const { handler, packet, stream } = await useSocketHandler();
        const { socket, writes } = useCapturedSocket();

        await handler.open(socket);
        stream.emit('hello');

        expect(stream.count()).toBe(0);
        expect(decodeWrites(packet, writes)).toEqual([
            { action: SocketEvent.Open, data: true },
        ]);
    });

    test('routes a user packet through Synapse and writes scoped streamed chunks plus stream end', async () => {
        const { handler, packet, calls } = await useSocketHandler({
            onNext: async (_packet, stream) => {
                stream.emit('he');
                stream.emit('llo');
            },
        });
        const { socket, writes } = useCapturedSocket();
        const input = { action: SocketEvent.User, data: 'hello' };

        await handler.data(socket, packet.encode(input));

        expect(calls).toEqual([input]);
        expect(decodeWrites(packet, writes)).toEqual([
            { action: SocketEvent.Data, data: 'he' },
            { action: SocketEvent.Data, data: 'llo' },
            { action: SocketEvent.StreamEnd, data: true },
        ]);
    });

    test('forwards structured agent signals without string coercion', async () => {
        const reply = { type: 'reply', chunk: 'hello' };
        const done = { type: 'done', chunk: '' };
        const { handler, packet } = await useSocketHandler({
            onNext: async (_packet, stream) => {
                stream.emit(reply);
                stream.emit(done);
            },
        });
        const { socket, writes } = useCapturedSocket();

        await handler.data(socket, packet.encode({ action: SocketEvent.User, data: 'hello' }));

        expect(decodeWrites(packet, writes)).toEqual([
            { action: SocketEvent.Data, data: reply },
            { action: SocketEvent.Data, data: done },
            { action: SocketEvent.StreamEnd, data: true },
        ]);
    });

    test('writes an error response for malformed JSON frames', async () => {
        const { handler, packet, calls } = await useSocketHandler();
        const { socket, writes } = useCapturedSocket();

        await handler.data(socket, frameFromJson('{"action":'));

        const responses = decodeWrites(packet, writes);
        expect(calls).toEqual([]);
        expect(responses).toHaveLength(1);
        expect(responses[0]?.action).toBe(SocketEvent.Error);
        expect(String(responses[0]?.data).length).toBeGreaterThan(0);
    });

    test('routes coalesced user packets through Synapse in order', async () => {
        const { handler, packet, calls } = await useSocketHandler({
            onNext: async (value, stream) => {
                stream.emit(String(value.data));
            },
        });
        const { socket, writes } = useCapturedSocket();
        const first = { action: SocketEvent.User, data: 'first' };
        const second = { action: SocketEvent.User, data: 'second' };

        await handler.data(socket, Buffer.concat([packet.encode(first), packet.encode(second)]));

        expect(calls).toEqual([first, second]);
        expect(decodeWrites(packet, writes)).toEqual([
            { action: SocketEvent.Data, data: 'first' },
            { action: SocketEvent.StreamEnd, data: true },
            { action: SocketEvent.Data, data: 'second' },
            { action: SocketEvent.StreamEnd, data: true },
        ]);
    });

    test('close releases packet decode state', async () => {
        const { handler, packet, stream } = await useSocketHandler();
        const { socket, writes } = useCapturedSocket();

        await handler.open(socket);
        await handler.close(socket);
        stream.emit('late');

        expect(stream.count()).toBe(0);
        expect(decodeWrites(packet, writes)).toEqual([
            { action: SocketEvent.Open, data: true },
        ]);
    });
});
