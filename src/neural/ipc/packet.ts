import { Service } from '@/core/decorator';
import { FService } from '@/core/ioc';

export const HEADER_BYTES = 8;
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const TEXT_ENCODING = 'utf-8';

/**
 * EN: SocketPacket interface declaration.
 * ZH: SocketPacket interface 声明。
 */
export interface SocketPacket<T = unknown> {
    action: string;
    data: T;
}

export interface PacketSplit {
    packets: Uint8Array[];
    rest: Buffer;
}

@Service()
/**
 * EN: Stateless IPC packet codec. Buffer ownership belongs to the Connection
 * that is being read; this class only encodes, decodes, and splits frames.
 * ZH: 无状态 IPC 包编解码器。buffer 所有权属于正在读取的 Connection；
 * 本类只负责编码、解码和切帧。
 */
export class IPCPacket extends FService {
    /**
     * EN: Appends inbound bytes to the connection buffer and slices every
     * complete frame, returning the unconsumed remainder.
     * ZH: 把入站字节追加到连接 buffer 并切出所有完整帧，返回未消费的剩余部分。
     */
    public split(buffer: Buffer, data: Uint8Array): PacketSplit {
        let current = Buffer.concat([buffer, Buffer.from(data)]);
        const packets: Uint8Array[] = [];

        while (current.byteLength >= HEADER_BYTES) {
            const bodyBytes = current.readBigUInt64BE(0);
            if (bodyBytes > BigInt(MAX_BODY_BYTES)) throw Error('Packet body exceeds limit');
            const packetBytes = HEADER_BYTES + Number(bodyBytes);
            if (current.byteLength < packetBytes) break;

            packets.push(current.subarray(0, packetBytes));
            current = Buffer.from(current.subarray(packetBytes));
        }

        return { packets, rest: current };
    }

    public decode<T = unknown>(data: Uint8Array): T {
        const buffer = Buffer.from(data);
        if (buffer.byteLength < HEADER_BYTES) throw Error('Incomplete packet header');

        const bodyBytes = buffer.readBigUInt64BE(0);
        if (bodyBytes > BigInt(MAX_BODY_BYTES)) throw Error('Packet body exceeds limit');
        const packetBytes = HEADER_BYTES + Number(bodyBytes);
        if (buffer.byteLength < packetBytes) throw Error('Incomplete packet body');
        if (buffer.byteLength !== packetBytes) throw Error('Packet byte length does not match header');

        const body = buffer.subarray(HEADER_BYTES, packetBytes);
        return JSON.parse(body.toString(TEXT_ENCODING)) as T;
    }

    public encode(packet: unknown): Buffer {
        const content = JSON.stringify(packet);
        if (content === undefined) throw Error('Packet content is not JSON serializable');

        const body = Buffer.from(content, TEXT_ENCODING);
        const header = Buffer.alloc(HEADER_BYTES);
        header.writeBigUInt64BE(BigInt(body.byteLength), 0);
        return Buffer.concat([header, body]);
    }
}
