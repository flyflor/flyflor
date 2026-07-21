import { Config, Init, Inject } from '@/core/decorator';
import { FlyFlor, useContainer } from '@/core/ioc';
import { rm } from 'fs/promises';
import type { Socket, UnixSocketListener } from 'bun';
import { Awareness } from '@/neural/awareness';
import { Connection, type ConnectionData } from './connection';
import { IPCPacket, type SocketPacket } from './packet';
import { Controller } from './controller';
import type { Synapse } from '../synapse';

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
    Interrupted = 'interrupted',
    Drain = 'drain',
    Handshake = 'handshake',
    End = 'end',
    ConnectError = 'connectError',
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
 * handed to Awareness as stimuli. Replies are addressed back to the speaker.
 * ZH: Unix socket 感官表面。FSocket 是同时听到多个说话人的耳朵。
 * 每条连接是一个说话人;所有入站帧作为刺激交给 Awareness。回复按说话人寻址。
 */
export class FSocket extends FlyFlor {
    @Config('socket')
    public path!: string;

    @Inject()
    public packet!: IPCPacket;

    @Inject()
    public controller!: Controller;

    @Inject()
    public awareness!: Awareness;

    public service?: UnixSocketListener<object>;

    public synapse?: Synapse;

    private connections = new Map<Socket<ConnectionData>, Connection>();
    private bySpeaker = new Map<string, Connection>();
    private sequence = 0;

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

    public async close(socket: Socket<ConnectionData>, error?: Error) {
        const connection = this.connections.get(socket);
        this.log.info(SocketEvent.Close, { speakerId: connection?.speakerId, error });
        if (connection) {
            connection.forget();
            this.awareness.forget(connection.speakerId);
            this.connections.delete(socket);
            this.bySpeaker.delete(connection.speakerId);
        }
    }

    public async error(socket: Socket<ConnectionData>, error: Error) {
        const connection = this.connections.get(socket);
        this.log.error(SocketEvent.Error, { speakerId: connection?.speakerId, error });
        if (connection) connection.write({ action: SocketEvent.Error, data: error.message });
    }

    public async drain(socket: Socket<ConnectionData>) {
        this.connections.get(socket)?.flush();
    }

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
                    this.awareness.perceive({ speakerId: connection.speakerId, text: this.readUserText(packet.data) });
                    continue;
                }
                if (action === SocketEvent.Answer) {
                    const answer = packet.data as { turnId?: unknown; id?: unknown; response?: unknown };
                    if (typeof answer?.turnId !== 'string' || typeof answer.id !== 'string') throw Error('Invalid interaction IPC packet');
                    try {
                        this.awareness.answer(answer.turnId, answer.id, answer.response, connection.speakerId);
                    } catch (error) {
                        this.log.warn('socket.answer.rejected', {
                            speakerId: connection.speakerId,
                            name: error instanceof Error ? error.name : 'UnknownError',
                        });
                    }
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
