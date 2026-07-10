import { Config, Init, Inject, Singleton } from '@/core/decorator';
import { FService } from '@/core/ioc';
import { rm } from 'fs/promises';
import type { Socket, UnixSocketListener } from 'bun';
import { IPCPacket, type SocketPacket } from './packet';
import { Controller } from './controller';

export enum SocketEvent {
    Constructor = 'constructor',
    Close = 'close',
    Error = 'error',
    Open = 'open',
    User = 'user',
    Answer = 'answer',
    Agent = 'agent',
    Data = 'data',
    StreamEnd = 'streamEnd',
    Drain = 'drain',
    Handshake = 'handshake',
    End = 'end',
    ConnectError = 'connectError',
    Timeout = 'timeout',
}

/**
 * EN: SocketConnectionData interface declaration.
 * ZH: SocketConnectionData interface 声明。
 */
export interface SocketConnectionData {}

export interface SocketCallbacks {
    input(text: string): void | Promise<void>;
    answer(turnId: string, id: string, response: unknown): void | Promise<void>;
}

/**
 * EN: Owns the process IPC listener, one live connection, and ordered backpressure.
 * ZH: 持有进程 IPC listener、唯一活动连接与有序 backpressure。
 */
@Singleton()
export class FSocket extends FService {
    @Config('socket')
    public path!: string;

    @Inject()
    public packet!: IPCPacket;

    @Inject()
    public controller!: Controller;

    public service?: UnixSocketListener<object>;

    public connection?: Socket<SocketConnectionData>;

    private pending: Buffer[];
    private callbacks?: SocketCallbacks;

    /** EN: Creates empty connection and backpressure state. ZH: 创建空连接与 backpressure 状态。 */
    constructor() {
        super();
        this.pending = [];
    }

    /** EN: Starts the configured IPC listener after injection. ZH: 注入完成后启动已配置 IPC listener。 */
    @Init()
    public async init() {
        await rm(this.path, { force: true });
        // this.service = Bun.listen({ unix: this.path, socket: this });
        this.service = Bun.listen({
            unix: this.path,
            socket: {
                open: this.open.bind(this),
                close: this.close.bind(this),
                error: this.error.bind(this),
                drain: this.drain.bind(this),
                data: this.data.bind(this),
            },
        });
        console.log(`[IPC] Socket listening at ${this.path}`);
    }

    /** EN: Adopts one connection without resetting life-form state. ZH: 接纳一个连接且不重置智能生命体状态。 */
    public async open(socket: Socket<SocketConnectionData>) {
        this.pending = [];
        this.packet.reset();
        this.connection = socket;
        this.log.info(SocketEvent.Open);
        this.write({ action: SocketEvent.Open, data: true });
    }

    /** EN: Releases only transport state owned by the closed connection. ZH: 只释放关闭连接所拥有的 transport 状态。 */
    public async close(socket: Socket<SocketConnectionData>, error?: Error) {
        this.log.info(SocketEvent.Close, { error });
        if (this.connection === socket) {
            this.connection = undefined;
            this.pending = [];
            this.packet.reset();
        }
    }

    /** EN: Reports one transport error through the same live connection. ZH: 通过同一活动连接报告 transport 错误。 */
    public async error(socket: Socket<SocketConnectionData>, error: Error) {
        this.log.error(SocketEvent.Error, error);
        this.write({ action: SocketEvent.Error, data: error.message });
    }

    /** EN: Resumes pending writes after Bun signals capacity. ZH: Bun 发出容量信号后恢复 pending writes。 */
    public async drain() {
        this.flush();
    }

    /** EN: Binds sensation and interaction callbacks without importing cognition. ZH: 绑定感觉与交互回调，不导入认知层。 */
    public bind(callbacks: SocketCallbacks): void {
        this.callbacks = callbacks;
    }

    /** EN: Decodes inbound frames and awaits every sensory callback. ZH: 解码入站 frames 并等待每个感觉回调。 */
    public async data(socket: Socket<SocketConnectionData>, data: Uint8Array) {
        if (socket !== this.connection) throw Error('Socket data came from a non-current connection');
        // this.log.info('data', data);
        for (const buffer of this.packet.read(data)) {
            const packet = this.packet.decode<SocketPacket>(buffer);
            if (packet.action === SocketEvent.User) {
                if (!this.callbacks) throw Error('Socket input callback is missing');
                await this.callbacks.input(this.readUserText(packet.data));
                continue;
            }
            if (packet.action === SocketEvent.Answer) {
                const answer = packet.data as { turnId?: unknown; id?: unknown; response?: unknown };
                if (typeof answer?.turnId !== 'string' || typeof answer.id !== 'string') throw Error('Invalid interaction IPC packet');
                if (!this.callbacks) throw Error('Socket answer callback is missing');
                await this.callbacks.answer(answer.turnId, answer.id, answer.response);
                continue;
            }
            await this.controller.dispatch(packet);
        }
    }

    /** EN: Queues one outbound packet or rejects when no connection exists. ZH: 排队一个出站 packet，无连接时直接拒绝。 */
    public write(packet: SocketPacket): void {
        if (!this.connection) throw Error('Socket connection is unavailable');
        this.pending.push(this.packet.encode(packet));
        this.flush();
    }

    /** EN: Writes queued bytes in order while honoring partial writes. ZH: 按序写入 queued bytes，并遵守 partial writes。 */
    private flush(): void {
        while (this.connection && this.pending.length > 0) {
            const current = this.pending[0]!;
            const written = this.connection.write(current);
            if (written < 0) break;
            if (written === current.byteLength) {
                this.pending.shift();
                continue;
            }
            if (written > 0) this.pending[0] = current.subarray(written);
            break;
        }
    }

    /** EN: Validates and extracts one user text stimulus. ZH: 验证并提取一个用户文本刺激。 */
    private readUserText(data: unknown): string {
        if (typeof data !== 'object' || data === null || !('text' in data)) throw Error('Invalid user IPC packet');
        return String((data as { text: unknown }).text);
    }
}
