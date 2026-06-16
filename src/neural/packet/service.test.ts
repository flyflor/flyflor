import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { PACKET_LENGTH_HEADER_BYTES, PACKET_MAX_CONTENT_BYTES, PACKET_PROTOCOL_MISMATCH_MESSAGE, PACKET_TEXT_ENCODING, PacketService, SocketEvent } from '@/neural/packet';

async function usePacketService(): Promise<PacketService> {
    return useContainer().getAsync(PacketService);
}

function packet(data: unknown) {
    return { action: SocketEvent.Data, data };
}

function frameFromJson(content: string): Buffer {
    const body = Buffer.from(content, PACKET_TEXT_ENCODING);
    const header = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
    header.writeBigUInt64BE(BigInt(body.byteLength), 0);
    return Buffer.concat([header, body]);
}

describe('PacketService', () => {
    test('encodes an 8-byte big-endian body length header', async () => {
        const service = await usePacketService();
        const value = packet('hello');
        const encoded = service.encode(value);
        const body = encoded.subarray(PACKET_LENGTH_HEADER_BYTES);

        expect(encoded.subarray(0, PACKET_LENGTH_HEADER_BYTES).readBigUInt64BE(0)).toBe(BigInt(body.byteLength));
        expect(JSON.parse(body.toString(PACKET_TEXT_ENCODING))).toEqual(value);
        expect(encoded.toString(PACKET_TEXT_ENCODING).endsWith('\n')).toBe(false);
    });

    test('buffers partial headers until the header is complete', async () => {
        const service = await usePacketService();
        const connection = {};
        const encoded = service.encode(packet('partial header'));

        expect(service.decode(connection, encoded.subarray(0, PACKET_LENGTH_HEADER_BYTES - 1))).toEqual({ packets: [], errors: [] });
        expect(service.decode(connection, encoded.subarray(PACKET_LENGTH_HEADER_BYTES - 1))).toEqual({
            packets: [packet('partial header')],
            errors: [],
        });
    });

    test('buffers partial bodies until the body is complete', async () => {
        const service = await usePacketService();
        const connection = {};
        const encoded = service.encode(packet('partial body'));
        const splitAt = PACKET_LENGTH_HEADER_BYTES + 3;

        expect(service.decode(connection, encoded.subarray(0, splitAt))).toEqual({ packets: [], errors: [] });
        expect(service.decode(connection, encoded.subarray(splitAt))).toEqual({
            packets: [packet('partial body')],
            errors: [],
        });
    });

    test('decodes multiple coalesced frames from one chunk', async () => {
        const service = await usePacketService();
        const connection = {};
        const first = packet('first');
        const second = packet({ value: 'second' });
        const chunk = Buffer.concat([service.encode(first), service.encode(second)]);

        expect(service.decode(connection, chunk)).toEqual({ packets: [first, second], errors: [] });
    });

    test('decodes JSON content containing newlines and unicode text', async () => {
        const service = await usePacketService();
        const connection = {};
        const value = packet('hello\n你好 🌸');

        expect(service.decode(connection, service.encode(value))).toEqual({ packets: [value], errors: [] });
    });

    test('reports malformed JSON and continues with following frames', async () => {
        const service = await usePacketService();
        const connection = {};
        const valid = packet('after malformed json');
        const chunk = Buffer.concat([frameFromJson('{"action":'), service.encode(valid)]);
        const result = service.decode(connection, chunk);

        expect(result.packets).toEqual([valid]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.frame).toBe('{"action":');
    });

    test('rejects an oversized declared frame length and clears the buffer', async () => {
        const service = await usePacketService();
        const connection = {};
        const badHeader = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
        badHeader.writeBigUInt64BE(BigInt(PACKET_MAX_CONTENT_BYTES) + 1n, 0);
        const valid = packet('fresh frame');

        const rejected = service.decode(connection, badHeader);
        expect(rejected.packets).toEqual([]);
        expect(rejected.errors).toHaveLength(1);

        expect(service.decode(connection, service.encode(valid))).toEqual({ packets: [valid], errors: [] });
    });

    test('rejects raw JSON text sent without an IPC length header', async () => {
        const service = await usePacketService();
        const connection = {};
        const result = service.decode(connection, Buffer.from('{"action":"user","data":"hello"}', PACKET_TEXT_ENCODING));

        expect(result.packets).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.error.message).toBe(PACKET_PROTOCOL_MISMATCH_MESSAGE);
    });

    test('rejects raw unicode text sent without an IPC length header', async () => {
        const service = await usePacketService();
        const connection = {};
        const result = service.decode(connection, Buffer.from('研究下这个项目', PACKET_TEXT_ENCODING));

        expect(result.packets).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.error.message).toBe(PACKET_PROTOCOL_MISMATCH_MESSAGE);
    });

    test('throws when encoded content exceeds the maximum frame size', async () => {
        const service = await usePacketService();

        expect(() => service.encode(packet('x'.repeat(PACKET_MAX_CONTENT_BYTES)))).toThrow('Packet content length exceeds maximum');
    });
});
