import { Service } from '@/core/decorator';
import { FService, of, type Observable } from '@/core/ioc';

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

@Service()
/**
 * EN: IPCPacket class declaration.
 * ZH: IPCPacket class 声明。
 */
export class IPCPacket extends FService {
    public buffer: Buffer;

    constructor() {
        super();
        this.buffer = Buffer.alloc(0);
    }

    public reset(): void {
        this.buffer = Buffer.alloc(0);
    }

    public of(data: Uint8Array): Observable<Uint8Array> {
        return of(...this.read(data));
    }

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

    public async *encodeStream<T>(packets: Iterable<T> | AsyncIterable<T>): AsyncGenerator<Buffer> {
        for await (const packet of packets) {
            yield this.encode(packet);
        }
    }
}
