import { Service } from '@/core/decorator';
import { FService } from '@/core/ioc';

/** EN: Byte length of the big-endian frame header that carries the JSON body length. ZH: 携带 JSON 包体长度的大端帧头字节数。 */
export const HEADER_BYTES = 8;
/** EN: Maximum accepted JSON body size; larger frames are rejected as malformed. ZH: 接受的 JSON 包体最大字节数；超过则视为畸形帧拒绝。 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** EN: Text encoding used for packet bodies. ZH: 包体使用的文本编码。 */
export const TEXT_ENCODING = 'utf-8';

/**
 * EN: One JSON packet on the IPC wire: an action discriminator plus its
 * payload. Encoded as an 8-byte big-endian body-length header followed by the
 * UTF-8 JSON body.
 * ZH: IPC 线上的一个 JSON 包：action 判别字段加其载荷。编码为 8 字节大端包体
 * 长度头后跟 UTF-8 JSON 包体。
 */
export interface SocketPacket<T = unknown> {
    /** EN: Action discriminator routing the packet to its handler. ZH: 将包路由到对应处理器的 action 判别字段。 */
    action: string;
    /** EN: Action-specific payload. ZH: 与 action 相关的载荷。 */
    data: T;
}

/**
 * EN: Result of slicing one inbound byte batch: every complete frame plus the
 * unconsumed remainder that must seed the next read.
 * ZH: 对一批入站字节切帧的结果：所有完整帧，加上必须留给下次读取的未消费
 * 剩余字节。
 */
export interface PacketSplit {
    /** EN: Complete frames sliced from the batch, header included. ZH: 从本批字节切出的完整帧（含帧头）。 */
    packets: Uint8Array[];
    /** EN: Trailing bytes of an incomplete frame, kept for the next read. ZH: 不完整帧的尾部字节，留给下次读取。 */
    rest: Buffer;
}

/**
 * EN: Stateless IPC packet codec. Buffer ownership belongs to the Connection
 * that is being read; this class only encodes, decodes, and splits frames.
 * ZH: 无状态 IPC 包编解码器。buffer 所有权属于正在读取的 Connection；
 * 本类只负责编码、解码和切帧。
 */
@Service()
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

    /**
     * EN: Decodes one complete frame: validates the header length against the
     * actual byte count and parses the UTF-8 JSON body. Throws on truncated,
     * oversized, or length-mismatched frames.
     * ZH: 解码一个完整帧：校验帧头长度与实际字节数，并解析 UTF-8 JSON 包体。
     * 截断、超限或长度不符的帧会抛错。
     */
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

    /**
     * EN: Encodes one packet into a framed buffer: UTF-8 JSON body prefixed by
     * an 8-byte big-endian body-length header.
     * ZH: 把一个包编码成带帧的 buffer：UTF-8 JSON 包体前加 8 字节大端包体
     * 长度头。
     */
    public encode(packet: unknown): Buffer {
        const content = JSON.stringify(packet);
        if (content === undefined) throw Error('Packet content is not JSON serializable');

        const body = Buffer.from(content, TEXT_ENCODING);
        const header = Buffer.alloc(HEADER_BYTES);
        header.writeBigUInt64BE(BigInt(body.byteLength), 0);
        return Buffer.concat([header, body]);
    }
}
