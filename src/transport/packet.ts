import { Provide } from '@/core/decorator';
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

/**
 * EN: Owns strict framing and JSON encoding for one IPC byte stream.
 * ZH: 持有一条 IPC byte stream 的严格 framing 与 JSON 编解码。
 */
@Provide()
export class IPCPacket extends FService {
    public buffer: Buffer;

    /** EN: Creates an empty incremental packet buffer. ZH: 创建空的增量 packet buffer。 */
    constructor() {
        super();
        this.buffer = Buffer.alloc(0);
    }

    /** EN: Clears incremental framing state for a new connection. ZH: 为新连接清空增量 framing 状态。 */
    public reset(): void {
        this.buffer = Buffer.alloc(0);
    }

    /** EN: Accepts arbitrary chunks and returns every complete frame. ZH: 接收任意 chunks 并返回全部完整 frame。 */
    public read(data: Uint8Array): Uint8Array[] {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(data)]);
        const packets: Uint8Array[] = [];

        while (this.buffer.byteLength >= HEADER_BYTES) {
            const bodyBytes = this.buffer.readBigUInt64BE(0);
            if (bodyBytes > BigInt(MAX_BODY_BYTES)) {
                this.buffer = Buffer.alloc(0);
                throw Error('Packet body exceeds limit');
            }
            const packetBytes = HEADER_BYTES + Number(bodyBytes);
            if (this.buffer.byteLength < packetBytes) break;

            const packet = this.buffer.subarray(0, packetBytes);
            this.buffer = Buffer.from(this.buffer.subarray(packetBytes));
            packets.push(packet);
        }

        return packets;
    }

    /** EN: Decodes one exact length-prefixed JSON frame. ZH: 解码一个精确长度前缀 JSON frame。 */
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

    /** EN: Encodes one value as an eight-byte length-prefixed JSON frame. ZH: 将一个值编码为八字节长度前缀 JSON frame。 */
    public encode(packet: unknown): Buffer {
        const content = JSON.stringify(packet);
        if (content === undefined) throw Error('Packet content is not JSON serializable');

        const body = Buffer.from(content, TEXT_ENCODING);
        const header = Buffer.alloc(HEADER_BYTES);
        header.writeBigUInt64BE(BigInt(body.byteLength), 0);
        return Buffer.concat([header, body]);
    }

    /** EN: Encodes a synchronous or asynchronous packet sequence. ZH: 编码同步或异步 packet 序列。 */
    public async *encodeStream<T>(packets: Iterable<T> | AsyncIterable<T>): AsyncGenerator<Buffer> {
        for await (const packet of packets) {
            yield this.encode(packet);
        }
    }
}
