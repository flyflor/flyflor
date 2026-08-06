import { FService, Service } from '@/core';

export const HEADER_BYTES = 8;
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const TEXT_ENCODING = 'utf-8';

export interface PacketReadResult {
    packets: Uint8Array[];
    pending: Buffer;
}

/** EN: Stateless 8-byte big-endian JSON packet codec. ZH: 无状态的 8-byte 大端 JSON packet codec。 */
@Service()
export class IPCPacket extends FService {
    public read(pending: Uint8Array, data: Uint8Array): PacketReadResult {
        let buffer = Buffer.concat([Buffer.from(pending), Buffer.from(data)]);
        const packets: Uint8Array[] = [];
        while (buffer.byteLength >= HEADER_BYTES) {
            const bodyBytes = buffer.readBigUInt64BE(0);
            if (bodyBytes > BigInt(MAX_BODY_BYTES)) throw Error('Packet body exceeds limit');
            const packetBytes = HEADER_BYTES + Number(bodyBytes);
            if (buffer.byteLength < packetBytes) break;
            packets.push(buffer.subarray(0, packetBytes));
            buffer = Buffer.from(buffer.subarray(packetBytes));
        }
        return { packets, pending: buffer };
    }

    public decode<T>(data: Uint8Array): T {
        const buffer = Buffer.from(data);
        if (buffer.byteLength < HEADER_BYTES) throw Error('Incomplete packet header');
        const bodyBytes = buffer.readBigUInt64BE(0);
        if (bodyBytes > BigInt(MAX_BODY_BYTES)) throw Error('Packet body exceeds limit');
        const packetBytes = HEADER_BYTES + Number(bodyBytes);
        if (buffer.byteLength !== packetBytes) throw Error('Packet byte length does not match header');
        return JSON.parse(buffer.subarray(HEADER_BYTES).toString(TEXT_ENCODING)) as T;
    }

    public encode(packet: unknown): Buffer {
        const content = JSON.stringify(packet);
        if (content === undefined) throw Error('Packet content is not JSON serializable');
        const body = Buffer.from(content, TEXT_ENCODING);
        if (body.byteLength > MAX_BODY_BYTES) throw Error('Packet body exceeds limit');
        const header = Buffer.alloc(HEADER_BYTES);
        header.writeBigUInt64BE(BigInt(body.byteLength), 0);
        return Buffer.concat([header, body]);
    }
}
