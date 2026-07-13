import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { HEADER_BYTES, IPCPacket, MAX_BODY_BYTES } from './packet';

describe('IPCPacket', () => {
    test('reassembles split headers, bodies, and UTF-8 bytes', () => {
        const packet = useContainer().create(IPCPacket);
        const encoded = packet.encode({ action: 'user', data: { text: '你好 Flyflor' } });
        const frames: Uint8Array[] = [];

        for (const byte of encoded) frames.push(...packet.read(Uint8Array.of(byte)));

        expect(frames).toHaveLength(1);
        expect(packet.decode<{ action: string; data: { text: string } }>(frames[0]!)).toEqual({ action: 'user', data: { text: '你好 Flyflor' } });
    });

    test('separates coalesced packets', () => {
        const packet = useContainer().create(IPCPacket);
        const first = packet.encode({ action: 'agent', data: 'a' });
        const second = packet.encode({ action: 'streamEnd', data: true });

        const frames = packet.read(Buffer.concat([first, second]));

        expect(frames.map((frame) => packet.decode(frame))).toEqual([
            { action: 'agent', data: 'a' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('rejects oversized and malformed packets', () => {
        const packet = useContainer().create(IPCPacket);
        const oversized = Buffer.alloc(HEADER_BYTES);
        oversized.writeBigUInt64BE(BigInt(MAX_BODY_BYTES + 1));

        expect(() => packet.read(oversized)).toThrow('Packet body exceeds limit');
        expect(() => packet.encode('x'.repeat(MAX_BODY_BYTES + 1))).toThrow('Packet body exceeds limit');
        expect(() => packet.decode(Buffer.concat([Buffer.alloc(HEADER_BYTES), Buffer.from('{')]))).toThrow('Packet byte length does not match header');
    });
});
