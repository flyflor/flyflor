import { describe, expect, test } from 'bun:test';
import {
    BROWSER_JSON_ONLY_MESSAGE,
    IpcClientBridge,
    PACKET_LENGTH_HEADER_BYTES,
    PACKET_LENGTH_INVALID_MESSAGE,
    PACKET_PROTOCOL_MISMATCH_MESSAGE,
    PACKET_TEXT_ENCODING,
} from './ipc-client.script';

function readPacketBody(packet: Buffer): string {
    const bodyLength = Number(packet.subarray(0, PACKET_LENGTH_HEADER_BYTES).readBigUInt64BE(0));
    return packet.subarray(PACKET_LENGTH_HEADER_BYTES, PACKET_LENGTH_HEADER_BYTES + bodyLength).toString(PACKET_TEXT_ENCODING);
}

describe('IPC client bridge packet helpers', () => {
    test('encodes browser JSON text as one length-prefixed IPC packet', () => {
        const content = JSON.stringify({ action: 'user', data: 'hello' });
        const encoded = IpcClientBridge.encodeBrowserMessage(content);
        const body = encoded.subarray(PACKET_LENGTH_HEADER_BYTES);

        expect(encoded.subarray(0, PACKET_LENGTH_HEADER_BYTES).readBigUInt64BE(0)).toBe(BigInt(body.byteLength));
        expect(readPacketBody(encoded)).toBe(content);
    });

    test('rejects browser binary messages instead of double-encoding them', () => {
        const content = JSON.stringify({ action: 'user', data: 'hello' });
        const alreadyEncoded = IpcClientBridge.encodePacketText(content);

        expect(() => IpcClientBridge.encodeBrowserMessage(alreadyEncoded)).toThrow(BROWSER_JSON_ONLY_MESSAGE);
    });

    test('rejects browser text that is not JSON', () => {
        expect(() => IpcClientBridge.encodeBrowserMessage('hello')).toThrow();
    });

    test('decodes kernel IPC packets into browser JSON texts', () => {
        const first = JSON.stringify({ action: 'open', data: true });
        const second = JSON.stringify({ action: 'data', data: 'hello' });
        const chunk = Buffer.concat([IpcClientBridge.encodePacketText(first), IpcClientBridge.encodePacketText(second)]);

        expect(IpcClientBridge.decodePacketTexts(Buffer.alloc(0), chunk)).toEqual({
            packets: [first, second],
            errors: [],
            pending: Buffer.alloc(0),
        });
    });

    test('buffers incomplete kernel packets until the body is complete', () => {
        const content = JSON.stringify({ action: 'data', data: 'partial' });
        const encoded = IpcClientBridge.encodePacketText(content);
        const splitAt = PACKET_LENGTH_HEADER_BYTES + 3;

        const first = IpcClientBridge.decodePacketTexts(Buffer.alloc(0), encoded.subarray(0, splitAt));
        expect(first).toEqual({
            packets: [],
            errors: [],
            pending: encoded.subarray(0, splitAt),
        });

        expect(IpcClientBridge.decodePacketTexts(first.pending, encoded.subarray(splitAt))).toEqual({
            packets: [content],
            errors: [],
            pending: Buffer.alloc(0),
        });
    });

    test('reports text where a length-prefixed packet is expected', () => {
        expect(IpcClientBridge.decodePacketTexts(Buffer.alloc(0), Buffer.from('{"action":"open","data":true}', PACKET_TEXT_ENCODING))).toEqual({
            packets: [],
            errors: [PACKET_PROTOCOL_MISMATCH_MESSAGE],
            pending: Buffer.alloc(0),
        });
    });

    test('reports invalid packet body length overflow', () => {
        const header = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
        header.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0);

        expect(IpcClientBridge.decodePacketTexts(Buffer.alloc(0), header)).toEqual({
            packets: [],
            errors: [PACKET_LENGTH_INVALID_MESSAGE],
            pending: Buffer.alloc(0),
        });
    });

    test('encodes content beyond the old transport business limit', () => {
        const oldLimit = 16 * 1024 * 1024;
        const content = JSON.stringify({ action: 'data', data: 'x'.repeat(oldLimit) });
        const encoded = IpcClientBridge.encodePacketText(content);

        expect(readPacketBody(encoded)).toBe(content);
    });
});
