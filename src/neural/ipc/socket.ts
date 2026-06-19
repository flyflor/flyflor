import { Config, FlyFlor, Init, Inject, Logger, Singleton, type FLogger } from '@/core';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import type { Socket, SocketHandler, UnixSocketListener } from 'bun';
import { IPCPacket, type SocketPacket } from './packet';
import { Controller } from './controller';
import type { Synapse } from '../synapse';

export enum SocketEvent {
    Constructor = 'constructor',
    Close = 'close',
    Error = 'error',
    Open = 'open',
    User = 'user',
    Agent = 'agent',
    Data = 'data',
    StreamEnd = 'streamEnd',
    Drain = 'drain',
    Handshake = 'handshake',
    End = 'end',
    ConnectError = 'connectError',
    Timeout = 'timeout',
}

export interface SocketConnectionData {}

/**
 * Bun socket handler used by IPCService.
 *
 * The class owns socket lifecycle callbacks only: connection open/close, inbound data, and transport
 * errors. Handlers are arrow-function fields so `this` is the FSocket instance however Bun invokes
 * them; the instance is passed straight to `Bun.listen({ socket })`.
 */
@Singleton()
export class FSocket extends FlyFlor implements SocketHandler<SocketConnectionData, 'buffer'> {
    @Config('socket')
    public path!: string;

    @Inject()
    public packet!: IPCPacket;

    @Inject()
    public controller!: Controller;

    public service?: UnixSocketListener<object>;

    public connection?: Socket<SocketConnectionData>;

    public synapse!: Synapse;

    constructor() {
        super();
    }

    @Init()
    public async init() {
        if (existsSync(this.path)) await unlink(this.path);
        this.service = Bun.listen({ unix: this.path, socket: this });
        console.log(`[IPC] Socket listening at ${this.path}`);
    }

    public open = async (socket: Socket<SocketConnectionData>) => {
        this.connection = socket;
        this.log.info(SocketEvent.Open);
        socket.write(this.packet.encode({ action: SocketEvent.Open, data: true }));
    };

    public close = async (socket: Socket<SocketConnectionData>, error?: Error) => {
        this.log.info(SocketEvent.Close, { error });
        if (this.connection === socket) this.connection = undefined;
        socket.write(this.packet.encode({ action: SocketEvent.Close, data: error?.message ?? 'closed' }));
    };

    public error = async (socket: Socket<SocketConnectionData>, error: Error) => {
        this.log.error(SocketEvent.Error, error);
        socket.write(this.packet.encode({ action: SocketEvent.Error, data: error.message }));
    };

    public data = async (socket: Socket<SocketConnectionData>, data: Uint8Array) => {
        // this.log.info('data', data);
        this.packet
            .of(data)
            .pipe((buffer: Uint8Array) => this.packet.decode(buffer))
            .filter<SocketPacket>(({ action, data }) => {
                if(['user'].includes(action)) {
                    // this.log.info('received', { action, data });
                    this.synapse.emit('data', typeof data === 'object' && data !== null && 'text' in data ? String((data as { text: unknown }).text) : data);
                    return false;
                }
                return true;
            })
            .subscribe<SocketPacket>(({ action, data }) => {
                // call controller method by action key
                const key = action as keyof Controller;
                const method = this.controller[key] as unknown as ((arg: any) => any) | undefined;
                if (typeof method === 'function') method.call(this.controller, data);
            });
    };

    public write(packet: SocketPacket): void {
        if (!this.connection) {
            this.log.warn('socket.write.no_connection', packet);
            return;
        }
        this.connection.write(this.packet.encode(packet));
    }
}
