import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { HEADER_BYTES, IPCPacket, MAX_BODY_BYTES } from './packet';

describe('IPCPacket', () => {
    test('decodes split UTF-8 packets and coalesced packets', async () => {
        const codec = await useContainer().getAsync(IPCPacket);
        const first = codec.encode({ text: '你好🙂' });
        const second = codec.encode({ text: 'next' });

        const split = codec.read(Buffer.alloc(0), first.subarray(0, HEADER_BYTES + 2));
        const completed = codec.read(split.pending, Buffer.concat([first.subarray(HEADER_BYTES + 2), second]));

        expect(split.packets).toEqual([]);
        expect(completed.pending.byteLength).toBe(0);
        expect(completed.packets.map((packet) => codec.decode(packet))).toEqual([{ text: '你好🙂' }, { text: 'next' }]);
    });

    test('rejects malformed lengths and non-exact packets', async () => {
        const codec = await useContainer().getAsync(IPCPacket);
        const oversized = Buffer.alloc(HEADER_BYTES);
        oversized.writeBigUInt64BE(BigInt(MAX_BODY_BYTES + 1));
        const encoded = codec.encode({ ok: true });

        expect(() => codec.read(Buffer.alloc(0), oversized)).toThrow('Packet body exceeds limit');
        expect(() => codec.decode(encoded.subarray(0, -1))).toThrow('Packet byte length does not match header');
    });
});
