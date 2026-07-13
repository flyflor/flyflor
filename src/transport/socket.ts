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

/** EN: Empty per-connection payload because all transport state belongs to FSocket. ZH: 每条连接不附带状态，因为 transport 状态全部归 FSocket 所有。 */
export interface SocketConnectionData {}

/** EN: Awaited lifecycle callbacks crossing from Transport into cortical owners. ZH: 从 Transport 跨入皮层所有者的 awaited 生命周期 callbacks。 */
export interface SocketCallbacks {
    connected(): void | Promise<void>;
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

    private service?: UnixSocketListener<object>;

    private connection?: Socket<SocketConnectionData>;

    private pending: Buffer[];
    private callbacks?: SocketCallbacks;

    /** EN: Creates empty connection and backpressure state. ZH: 创建空连接与 backpressure 状态。 */
    constructor() {
        super();
        this.service = undefined;
        this.connection = undefined;
        this.pending = [];
        this.callbacks = undefined;
    }

    /** EN: Starts the configured IPC listener after injection. ZH: 注入完成后启动已配置 IPC listener。 */
    @Init()
    public async init() {
        await rm(this.path, { force: true });
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
        if (this.callbacks) await this.announce(this.callbacks);
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
        if (socket !== this.connection) throw Error('Socket error came from a non-current connection');
        this.log.error(SocketEvent.Error, error);
        this.write({ action: SocketEvent.Error, data: error.message });
    }

    /** EN: Resumes pending writes after Bun signals capacity. ZH: Bun 发出容量信号后恢复 pending writes。 */
    public async drain(socket: Socket<SocketConnectionData>) {
        if (socket !== this.connection) throw Error('Socket drain came from a non-current connection');
        this.flush();
    }

    /** EN: Stops the initialized IPC listener during controlled process cleanup. ZH: 在受控进程清理时停止已初始化的 IPC listener。 */
    public stop(): void {
        if (!this.service) throw Error('Socket service is unavailable');
        this.service.stop(true);
    }

    /** EN: Binds sensation and interaction callbacks without importing cognition. ZH: 绑定感觉与交互回调，不导入认知层。 */
    public async bind(callbacks: SocketCallbacks): Promise<void> {
        if (this.callbacks) throw Error('Socket callbacks are already bound');
        this.callbacks = callbacks;
        if (this.connection) await this.announce(callbacks);
    }

    /** EN: Reports whether one live transport connection can accept output. ZH: 报告是否有一个可接收输出的活动 transport 连接。 */
    public get connected(): boolean {
        return this.connection !== undefined;
    }

    /** EN: Decodes inbound frames and awaits every sensory callback. ZH: 解码入站 frames 并等待每个感觉回调。 */
    public async data(socket: Socket<SocketConnectionData>, data: Uint8Array) {
        if (socket !== this.connection) throw Error('Socket data came from a non-current connection');
        for (const buffer of this.packet.read(data)) {
            const packet = this.readPacket(this.packet.decode<unknown>(buffer));
            if (packet.action === SocketEvent.User) {
                const text = this.readUserText(packet.data);
                if (!this.callbacks) throw Error('Socket input callback is missing');
                await this.callbacks.input(text);
                continue;
            }
            if (packet.action === SocketEvent.Answer) {
                if (typeof packet.data !== 'object' || packet.data === null || Array.isArray(packet.data)) throw Error('Invalid interaction IPC packet');
                const answer = packet.data as { turnId?: unknown; id?: unknown; response?: unknown };
                if (typeof answer.turnId !== 'string' || answer.turnId.length === 0
                    || typeof answer.id !== 'string' || answer.id.length === 0
                    || !('response' in answer)) throw Error('Invalid interaction IPC packet');
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

    /** EN: Announces one ready connection before replaying cortical interaction state. ZH: 先宣布连接就绪，再重放皮层交互状态。 */
    private async announce(callbacks: SocketCallbacks): Promise<void> {
        this.write({ action: SocketEvent.Open, data: true });
        await callbacks.connected();
    }

    /** EN: Validates and extracts one user text stimulus. ZH: 验证并提取一个用户文本刺激。 */
    private readUserText(data: unknown): string {
        if (typeof data !== 'object' || data === null || Array.isArray(data) || !('text' in data)) throw Error('Invalid user IPC packet');
        const text = (data as { text: unknown }).text;
        if (typeof text !== 'string' || text.length === 0) throw Error('Invalid user IPC packet');
        return text;
    }

    /** EN: Validates one decoded IPC root before action routing. ZH: 在 action 路由前验证一个已解码 IPC 根对象。 */
    private readPacket(value: unknown): SocketPacket {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Invalid IPC packet root');
        const packet = value as { action?: unknown; data?: unknown };
        if (typeof packet.action !== 'string' || packet.action.length === 0 || !('data' in packet)) throw Error('Invalid IPC packet root');
        return { action: packet.action, data: packet.data };
    }
}
