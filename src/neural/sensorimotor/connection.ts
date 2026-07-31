import type { Socket } from 'bun';
import { Inject, Provide } from '@/core/decorator';
import { FComponent } from '@/core/ioc';
import { IPCPacket, type SocketPacket } from './packet';

/**
 * EN: Data Bun attaches to one accepted unix socket.
 * ZH: Bun 挂在每条已接受 unix socket 上的数据。
 */
export interface ConnectionData {
    /** EN: Speaker id assigned by FSocket when the connection was accepted. ZH: FSocket 接受连接时分配的说话人 id。 */
    speakerId?: string;
}

/**
 * EN: One speaker's ear and mouth. Each accepted socket gets its own
 * Connection with a private inbound frame buffer and a private outbound
 * pending queue, so interleaved speakers never corrupt each other's packets.
 * ZH: 一个说话人的耳朵和嘴。每条已接受的 socket 拥有独立 Connection，
 * 持有私有入站帧缓冲和私有出站待发队列，多个说话人交错时互不串包。
 */
@Provide()
export class Connection extends FComponent {
    /** EN: Stateless packet codec shared across connections. ZH: 各连接共享的无状态包编解码器。 */
    @Inject()
    public packet!: IPCPacket;

    private buffer: Buffer;
    private pending: Buffer[];

    constructor(
        /** EN: Raw Bun socket this connection wraps. ZH: 本连接包装的 Bun 原始 socket。 */
        public readonly socket: Socket<ConnectionData>,
        /** EN: Speaker id assigned to this connection. ZH: 分配给本连接的说话人 id。 */
        public readonly speakerId: string,
    ) {
        super();
        // EN: Leftover inbound bytes not yet forming a complete frame. ZH: 尚未组成完整帧的入站剩余字节。
        this.buffer = Buffer.alloc(0);
        // EN: Encoded outbound frames waiting on socket backpressure. ZH: 因 socket 背压等待发出的已编码出站帧。
        this.pending = [];
    }

    /**
     * EN: Appends inbound bytes and returns every complete frame.
     * ZH: 追加入站字节并返回所有完整帧。
     */
    public read(data: Uint8Array): Uint8Array[] {
        try {
            const split = this.packet.split(this.buffer, data);
            this.buffer = split.rest;
            return split.packets;
        } catch (error) {
            this.buffer = Buffer.alloc(0);
            throw error;
        }
    }

    /**
     * EN: Queues one packet for this speaker and flushes what the socket accepts.
     * ZH: 为该说话人排队一个包，并冲刷 socket 能接收的部分。
     */
    public write(packet: SocketPacket): void {
        this.pending.push(this.packet.encode(packet));
        this.flush();
    }

    /**
     * EN: Continues writing pending frames after backpressure drains.
     * ZH: 背压解除后继续写待发帧。
     */
    public flush(): void {
        while (this.pending.length > 0) {
            const current = this.pending[0]!;
            const written = this.socket.write(current);
            if (written < 0) break;
            if (written === current.byteLength) {
                this.pending.shift();
                continue;
            }
            if (written > 0) this.pending[0] = current.subarray(written);
            break;
        }
    }

    /**
     * EN: Drops all unsent output and unparsed input. The speaker has left.
     * ZH: 丢弃所有未发出的输出和未解析的输入。说话人已经离开。
     */
    public forget(): void {
        this.pending = [];
        this.buffer = Buffer.alloc(0);
    }
}
