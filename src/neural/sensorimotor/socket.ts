import { Config, Init, Inject, Singleton } from '@/core/decorator';
import { FlyFlor, useContainer } from '@/core/ioc';
import { rm } from 'fs/promises';
import type { Socket, UnixSocketListener } from 'bun';
import type { PopulationRouter } from '@/population/types';
import { Connection, type ConnectionData } from './connection';
import { IPCPacket, type SocketPacket } from './packet';
import { Controller } from './controller';

/**
 * EN: Well-known IPC action names used on the unix socket protocol. Inbound
 * `user`/`answer`/`route` packets are handled by FSocket itself; any other
 * action is reflected onto a same-named Controller method.
 * ZH: Unix socket 协议上约定的 IPC action 名。入站 `user`/`answer`/`route`
 * 包由 FSocket 自身处理；其余 action 会反射到 Controller 上的同名方法。
 */
export enum SocketEvent {
    /** EN: Lifecycle event for connection construction. ZH: 连接建立的生命周期事件。 */
    Constructor = 'constructor',
    /** EN: A speaker connection closed. ZH: 说话人连接关闭。 */
    Close = 'close',
    /** EN: Socket-level error notice written back to the speaker. ZH: 写回说话人的 socket 级错误通知。 */
    Error = 'error',
    /** EN: New speaker connection accepted; carries the assigned speakerId. ZH: 接受了新的说话人连接；携带分配到的 speakerId。 */
    Open = 'open',
    /** EN: Inbound user message turned into a stimulus routed to one agent. ZH: 入站用户消息，会转化为路由给某个 agent 的刺激。 */
    User = 'user',
    /** EN: Inbound answer to a pending ask/confirm interaction. ZH: 针对待处理 ask/confirm 交互的入站答复。 */
    Answer = 'answer',
    /** EN: Inbound request to rebind the speaker to another agent. ZH: 把说话人换绑到另一个 agent 的入站请求。 */
    Route = 'route',
    /** EN: Outbound streamed reply chunk. ZH: 出站流式回复分片。 */
    Agent = 'agent',
    /** EN: Generic outbound event payload. ZH: 通用出站事件载荷。 */
    Data = 'data',
    /** EN: Outbound notice that the current reply stream has ended. ZH: 当前回复流已结束的出站通知。 */
    StreamEnd = 'streamEnd',
    /** EN: Outbound notice that the current stream was interrupted. ZH: 当前流被打断的出站通知。 */
    Interrupted = 'interrupted',
    /** EN: Socket backpressure drained; pending writes may continue. ZH: socket 背压已解除；可继续写待发数据。 */
    Drain = 'drain',
    /** EN: Connection handshake action. ZH: 连接握手 action。 */
    Handshake = 'handshake',
    /** EN: Peer ended the connection. ZH: 对端结束了连接。 */
    End = 'end',
    /** EN: Outbound connection attempt failed. ZH: 出站连接尝试失败。 */
    ConnectError = 'connectError',
    /** EN: Connection or packet wait timed out. ZH: 连接或包等待超时。 */
    Timeout = 'timeout',
}

/**
 * EN: Legacy alias for connection-bound data. Keep for compatibility; each
 * accepted socket now owns a Connection instance.
 * ZH: 与连接绑定数据的兼容别名。现在每条已接受的 socket 都拥有一个
 * Connection 实例。
 */
export type SocketConnectionData = ConnectionData;

/**
 * EN: Unix socket sensory surface. FSocket is the ear that hears multiple
 * speakers at once. Every connection is a speaker; all inbound frames are
 * handed to the attached population router. Replies are addressed back to the
 * speaker. The transport is a population-wide singleton: every agent shares
 * this one listener for motor output.
 * ZH: Unix socket 感官表面。FSocket 是同时听到多个说话人的耳朵。
 * 每条连接是一个说话人;所有入站帧交给挂载的种群路由器。回复按说话人寻址。
 * 该传输是种群级单例:所有 agent 共享同一个监听器做运动输出。
 */
@Singleton()
export class FSocket extends FlyFlor {
    /** EN: Filesystem path of the unix socket, from configuration. ZH: 来自配置的 unix socket 文件路径。 */
    @Config('socket')
    public path!: string;

    /** EN: Stateless packet codec used to encode/decode frames. ZH: 用于编解码帧的无状态包编解码器。 */
    @Inject()
    public packet!: IPCPacket;

    /** EN: Action dispatcher for non-user inbound packets. ZH: 处理非用户类入站包的 action 派发器。 */
    @Inject()
    public controller!: Controller;

    /** EN: Population router that receives every inbound stimulus; unattached frames are dropped with a warning. ZH: 接收所有入站刺激的种群路由器；未挂载时帧告警丢弃。 */
    public router?: PopulationRouter;

    /** EN: Live Bun unix socket listener, set by init(). ZH: 由 init() 建立的 Bun unix socket 监听器。 */
    public service?: UnixSocketListener<object>;

    private connections: Map<Socket<ConnectionData>, Connection>;
    private bySpeaker: Map<string, Connection>;
    private sequence: number;

    constructor() {
        super();
        // EN: Live connections keyed by their raw socket. ZH: 按原始 socket 索引的活跃连接。
        this.connections = new Map();
        // EN: Live connections keyed by assigned speaker id. ZH: 按分配的说话人 id 索引的活跃连接。
        this.bySpeaker = new Map();
        // EN: Monotonic counter used to mint speaker ids. ZH: 用于生成说话人 id 的单调计数器。
        this.sequence = 0;
    }

    /**
     * EN: Lifecycle init: remove any stale socket file, then start listening
     * with every Bun socket callback bound to this instance.
     * ZH: 生命周期初始化：先删除残留的 socket 文件，再开始监听，并将所有 Bun
     * socket 回调绑定到本实例。
     */
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

    /**
     * EN: Attaches the population router that owns inbound `user`/`answer`/
     * `route` packets and speaker farewells. Called once by the population
     * root during bootstrap.
     * ZH: 挂载拥有入站 `user`/`answer`/`route` 包与说话人道别的种群路由器。
     * 启动期由种群根调用一次。
     */
    public attachRouter(router: PopulationRouter): void {
        this.router = router;
    }

    /**
     * EN: Accepts a new speaker: mints a sequential speakerId, creates a
     * Connection through the IOC container, indexes it both ways, and greets
     * the speaker with an `open` packet carrying its id.
     * ZH: 接受新说话人：生成递增的 speakerId，经 IOC 容器创建 Connection，双向
     * 索引，并用携带该 id 的 `open` 包向说话人致意。
     */
    public async open(socket: Socket<ConnectionData>) {
        this.sequence += 1;
        const speakerId = `conn_${this.sequence}`;
        const connection = await useContainer().getAsync(Connection, socket, speakerId);
        this.connections.set(socket, connection);
        this.bySpeaker.set(speakerId, connection);
        socket.data = { speakerId };
        this.log.info(SocketEvent.Open, { speakerId });
        connection.write({ action: SocketEvent.Open, data: { speakerId } });
    }

    /**
     * EN: Tears down a departing speaker: drops its Connection state, tells
     * the population router to forget it, and removes both indexes.
     * ZH: 拆除离开的说话人：丢弃其 Connection 状态，通知种群路由器遗忘它，并移除
     * 两个索引。
     */
    public async close(socket: Socket<ConnectionData>, error?: Error) {
        const connection = this.connections.get(socket);
        this.log.info(SocketEvent.Close, { speakerId: connection?.speakerId, error });
        if (connection) {
            connection.forget();
            this.router?.forget(connection.speakerId);
            this.connections.delete(socket);
            this.bySpeaker.delete(connection.speakerId);
        }
    }

    /**
     * EN: Reports a socket-level error back to the affected speaker as an
     * `error` packet.
     * ZH: 把 socket 级错误以 `error` 包报告给受影响的说话人。
     */
    public async error(socket: Socket<ConnectionData>, error: Error) {
        const connection = this.connections.get(socket);
        this.log.error(SocketEvent.Error, { speakerId: connection?.speakerId, error });
        if (connection) connection.write({ action: SocketEvent.Error, data: error.message });
    }

    /**
     * EN: Backpressure relief callback: resumes flushing the connection's
     * pending outbound queue.
     * ZH: 背压解除回调：继续冲刷该连接的待发队列。
     */
    public async drain(socket: Socket<ConnectionData>) {
        this.connections.get(socket)?.flush();
    }

    /**
     * EN: Inbound byte handler. Bytes may arrive split across chunks or with
     * several frames coalesced; the Connection reassembles complete frames,
     * each is decoded, and `user`/`answer`/`route` packets go to the attached
     * population router while other actions dispatch to a same-named
     * Controller method. One malformed packet is logged and skipped without
     * aborting the frames that follow it.
     * ZH: 入站字节处理器。字节可能分包到达或多帧粘连；Connection 负责重组出完整
     * 帧，逐帧解码后，`user`/`answer`/`route` 包交给挂载的种群路由器，其余
     * action 反射派发到 Controller 同名方法。单个畸形包只记录并跳过，不会中断
     * 其后的帧。
     */
    public async data(socket: Socket<ConnectionData>, data: Uint8Array) {
        const connection = this.connections.get(socket);
        if (!connection) return;

        let packets: SocketPacket[];
        try {
            packets = connection.read(data).map((buffer) => this.packet.decode<SocketPacket>(buffer));
        } catch (error) {
            this.log.error(SocketEvent.Error, { speakerId: connection.speakerId, error });
            return;
        }

        for (const packet of packets) {
            const action = this.packetAction(packet);
            try {
                if (action === SocketEvent.User) {
                    const text = this.readUserText(packet.data);
                    if (!this.router) {
                        this.log.warn('socket.router.missing', { speakerId: connection.speakerId, action });
                        continue;
                    }
                    this.router.perceive({ speakerId: connection.speakerId, text });
                    continue;
                }
                if (action === SocketEvent.Answer) {
                    const answer = packet.data as { turnId?: unknown; id?: unknown; response?: unknown };
                    if (typeof answer?.turnId !== 'string' || typeof answer.id !== 'string') throw Error('Invalid interaction IPC packet');
                    try {
                        this.router?.answer(answer.turnId, answer.id, answer.response, connection.speakerId);
                    } catch (error) {
                        this.log.warn('socket.answer.rejected', {
                            speakerId: connection.speakerId,
                            name: error instanceof Error ? error.name : 'UnknownError',
                        });
                    }
                    continue;
                }
                if (action === SocketEvent.Route) {
                    const route = packet.data as { agent?: unknown };
                    const ok = typeof route?.agent === 'string' && (this.router?.route(connection.speakerId, route.agent) ?? false);
                    connection.write({ action: SocketEvent.Route, data: { agent: route?.agent, ok } });
                    continue;
                }
                if (action === undefined) throw Error('Invalid IPC packet action');
                const method = Reflect.get(this.controller, action) as ((arg: unknown) => unknown) | undefined;
                if (typeof method === 'function') await method.call(this.controller, packet.data);
            } catch (error) {
                // A malformed packet must not abort processing of coalesced
                // frames that follow it on the same connection.
                this.log.warn('socket.packet.rejected', {
                    speakerId: connection.speakerId,
                    action,
                    name: error instanceof Error ? error.name : 'UnknownError',
                });
            }
        }
    }

    /**
     * EN: Writes one packet to a specific speaker. If the speaker has left, the
     * packet is silently dropped.
     * ZH: 向指定说话人写回一个包。若说话人已离开,则静默丢弃。
     */
    public write(speakerId: string, packet: SocketPacket): void {
        const connection = this.bySpeaker.get(speakerId);
        if (!connection) {
            this.log.warn('socket.write.no_connection', { speakerId, action: packet.action });
            return;
        }
        connection.write(packet);
    }

    private readUserText(data: unknown): string {
        if (typeof data !== 'object' || data === null || !('text' in data)) throw Error('Invalid user IPC packet');
        return String((data as { text: unknown }).text);
    }

    private packetAction(packet: unknown): string | undefined {
        if (typeof packet !== 'object' || packet === null || !('action' in packet)) return undefined;
        const action = (packet as { action?: unknown }).action;
        return typeof action === 'string' ? action : undefined;
    }
}
