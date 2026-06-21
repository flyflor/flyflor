import { describe, expect, test } from 'bun:test';
import { IpcClientBridge, PACKET_JSON_INVALID_MESSAGE } from './client';

function packet(text: string): Buffer {
    return IpcClientBridge.encodePacketText(text);
}

describe('IpcClientBridge', () => {
    test('decodes split length-prefixed JSON packets', () => {
        const source = packet(JSON.stringify({ action: 'agent', data: '你好\nworld' }));
        const first = IpcClientBridge.decodePacketTexts(Buffer.alloc(0), source.subarray(0, 6));
        const second = IpcClientBridge.decodePacketTexts(first.pending, source.subarray(6));

        expect(first.packets).toEqual([]);
        expect(second.errors).toEqual([]);
        expect(second.packets).toEqual([JSON.stringify({ action: 'agent', data: '你好\nworld' })]);
    });

    test('rejects malformed JSON packet bodies before browser forwarding', () => {
        const bad = packet('{"action":"agent","data":"bad\njson"}');
        const result = IpcClientBridge.decodePacketTexts(Buffer.alloc(0), bad);

        expect(result.packets).toEqual([]);
        expect(result.errors[0]).toContain(PACKET_JSON_INVALID_MESSAGE);
    });
});
