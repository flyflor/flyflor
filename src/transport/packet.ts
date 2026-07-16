import { Provide } from '@/core/decorator';
import { FService } from '@/core/ioc';

/** ZH: 固定 IPC frame 头字节数（unsigned big-endian body 长度）。 EN: Fixed IPC frame header size in bytes (unsigned big-endian body length). */
export const HEADER_BYTES = 8;
/** ZH: 允许的最大 IPC body 大小（4 MiB）。 EN: Maximum accepted IPC body size (4 MiB). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** ZH: IPC JSON body 使用的 UTF-8 编码。 EN: UTF-8 encoding used for IPC JSON bodies. */
export const TEXT_ENCODING = 'utf-8';

/** ZH: 稳定 IPC frame 内的一组 action 与 payload。 EN: One action and payload inside the stable IPC frame. */
export interface SocketPacket<T = unknown> {
    action: string;
    data: T;
}

/**
 * ZH: 持有一条 IPC byte stream 的严格 framing 与 JSON 编解码。
 * EN: Owns strict framing and JSON encoding for one IPC byte stream.
 */
@Provide()
export class IPCPacket extends FService {
    private buffer: Buffer;

    /** ZH: 创建空的增量 packet buffer。 EN: Creates an empty incremental packet buffer. */
    constructor() {
        super();
        this.buffer = Buffer.alloc(0);
    }

    /** ZH: 为新连接清空增量 framing 状态。 EN: Clears incremental framing state for a new connection. */
    public reset(): void {
        this.buffer = Buffer.alloc(0);
    }

    /** ZH: 接收任意 chunks 并返回全部完整 frame。 EN: Accepts arbitrary chunks and returns every complete frame. */
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

    /** ZH: 解码一个精确长度前缀 JSON frame。 EN: Decodes one exact length-prefixed JSON frame. */
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

    /** ZH: 将一个值编码为八字节长度前缀 JSON frame。 EN: Encodes one value as an eight-byte length-prefixed JSON frame. */
    public encode(packet: unknown): Buffer {
        const content = JSON.stringify(packet);
        if (content === undefined) throw Error('Packet content is not JSON serializable');

        const body = Buffer.from(content, TEXT_ENCODING);
        if (body.byteLength > MAX_BODY_BYTES) throw Error('Packet body exceeds limit');
        const header = Buffer.alloc(HEADER_BYTES);
        header.writeBigUInt64BE(BigInt(body.byteLength), 0);
        return Buffer.concat([header, body]);
    }

    /** ZH: 编码同步或异步 packet 序列。 EN: Encodes a synchronous or asynchronous packet sequence. */
    public async *encodeStream<T>(packets: Iterable<T> | AsyncIterable<T>): AsyncGenerator<Buffer> {
        for await (const packet of packets) {
            yield this.encode(packet);
        }
    }
}
