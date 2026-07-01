import { Config, Init, Inject, Singleton } from '@/core/decorator';
import { FlyFlor } from '@/core/ioc';
import { rm } from 'fs/promises';
import type { Socket, UnixSocketListener } from 'bun';
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

const SYNAPSE_INPUT = 'input' as Parameters<Synapse['emit']>[0];

/**
 * Bun socket handler used by the runtime IPC listener.
 *
 * The class owns socket lifecycle callbacks only: connection open/close, inbound data, and transport
 * errors. Callback methods are bound in the constructor so `this` is the FSocket instance however
 * Bun invokes them; the instance is passed straight to `Bun.listen({ socket })`.
 */
@Singleton()
/**
 * EN: FSocket class declaration.
 * ZH: FSocket class 声明。
 */
export class FSocket extends FlyFlor {
    @Config('socket')
    public path!: string;

    @Inject()
    public packet!: IPCPacket;

    @Inject()
    public controller!: Controller;

    public service?: UnixSocketListener<object>;

    public connection?: Socket<SocketConnectionData>;

    public synapse!: Synapse;

    private pending: Buffer[];

    constructor() {
        super();
        this.pending = [];
    }

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

    public async open(socket: Socket<SocketConnectionData>) {
        this.connection = socket;
        this.log.info(SocketEvent.Open);
        this.write({ action: SocketEvent.Open, data: true });
    }

    public async close(socket: Socket<SocketConnectionData>, error?: Error) {
        this.log.info(SocketEvent.Close, { error });
        if (this.connection === socket) {
            this.connection = undefined;
            this.pending = [];
        }
    }

    public async error(socket: Socket<SocketConnectionData>, error: Error) {
        this.log.error(SocketEvent.Error, error);
        this.write({ action: SocketEvent.Error, data: error.message });
    }

    public async drain() {
        this.flush();
    }

    public async data(socket: Socket<SocketConnectionData>, data: Uint8Array) {
        // this.log.info('data', data);
        this.packet
            .of(data)
            .pipe((buffer: Uint8Array) => this.packet.decode<SocketPacket>(buffer))
            .switch((packet) => (packet as unknown as SocketPacket).action, {
                [SocketEvent.User]: (packet) => {
                    this.synapse.emit(SYNAPSE_INPUT, this.readUserText((packet as unknown as SocketPacket).data));
                    return undefined;
                },
                [SocketEvent.Answer]: (packet) => {
                    this.synapse.emit(SYNAPSE_INPUT, this.readUserText((packet as unknown as SocketPacket).data));
                    return undefined;
                },
            })
            .subscribe<SocketPacket>((packet) => Reflect.get(this.controller, packet.action)?.call(this.controller, packet.data));
    }

    public write(packet: SocketPacket): void {
        if (!this.connection) {
            this.log.warn('socket.write.no_connection', packet);
            return;
        }
        this.pending.push(this.packet.encode(packet));
        this.flush();
    }

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

    private readUserText(data: unknown): string {
        if (typeof data !== 'object' || data === null || !('text' in data)) throw Error('Invalid user IPC packet');
        return String((data as { text: unknown }).text);
    }
}
