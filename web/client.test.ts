import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { BROWSER_JSON_ONLY_MESSAGE, IpcClientBridge, PACKET_JSON_INVALID_MESSAGE, PACKET_PROTOCOL_MISMATCH_MESSAGE } from './client';

/**
 * EN: packet function declaration.
 * ZH: packet function 声明。
 */
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

    test('decodes coalesced length-prefixed JSON packets', () => {
        const first = JSON.stringify({ action: 'agent', data: 'one' });
        const second = JSON.stringify({ action: 'streamEnd', data: null });
        const result = IpcClientBridge.decodePacketTexts(Buffer.alloc(0), Buffer.concat([packet(first), packet(second)]));

        expect(result.errors).toEqual([]);
        expect(result.pending.byteLength).toBe(0);
        expect(result.packets).toEqual([first, second]);
    });

    test('rejects raw text where a length-prefixed packet is expected', () => {
        const result = IpcClientBridge.decodePacketTexts(Buffer.alloc(0), Buffer.from('{"action":"agent","data":"raw"}'));

        expect(result.packets).toEqual([]);
        expect(result.errors[0]).toBe(PACKET_PROTOCOL_MISMATCH_MESSAGE);
    });

    test('encodes browser JSON messages and rejects binary messages', () => {
        const text = JSON.stringify({ action: 'user', data: { text: 'hello' } });
        const encoded = IpcClientBridge.encodeBrowserMessage(text);

        expect(encoded.readBigUInt64BE(0)).toBe(BigInt(Buffer.byteLength(text)));
        expect(encoded.subarray(8).toString('utf8')).toBe(text);
        expect(() => IpcClientBridge.encodeBrowserMessage(Buffer.from(text))).toThrow(BROWSER_JSON_ONLY_MESSAGE);
    });

    test('keeps the HTML client free of local names and machine-specific paths', () => {
        const html = readFileSync(join(process.cwd(), 'web/client.html'), 'utf8');

        expect(html).not.toMatch(/Flyflor|FlyFlor|FLYFLOR/);
        expect(html).not.toContain('/Users/yihuaqing/');
    });
});
