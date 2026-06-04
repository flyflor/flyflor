import { Logger, Singleton, type FLogger } from '@/core';
import type { BinaryType, Socket, SocketHandler } from 'bun';
import type { NeuralTransformer } from '../controller';

const SOCKET_LOG_SCOPE = 'IPC.Socket';
const SOCKET_BINARY_TYPE: BinaryType = 'buffer';
const FUNCTION_TYPE = 'function';

/**
 * Socket lifecycle event names used in IPC socket logs and socket packets.
 */
export enum SocketEvent {
    Constructor = 'constructor',
    Close = 'close',
    Error = 'error',
    Open = 'open',
    Data = 'data',
    Drain = 'drain',
    Handshake = 'handshake',
    End = 'end',
    ConnectError = 'connectError',
    Timeout = 'timeout',
}

/**
 * Packet shape written through the IPC socket.
 *
 * @template T Payload type associated with the socket lifecycle action.
 */
export interface SocketPacket<T = unknown> {
    action: SocketEvent;
    data: T;
}

/**
 * Bun socket handler used by IPCService.
 *
 * The class owns socket lifecycle callbacks only: connection open/close, inbound data, backpressure,
 * handshake, timeout, and transport errors. Each callback logs its lifecycle event so IPC socket behavior
 * can be traced without changing the wire protocol.
 */
@Singleton()
export class FSocket<Data = SocketPacket> implements SocketHandler<Data, 'buffer'> {
    @Logger(SOCKET_LOG_SCOPE)
    public readonly log!: FLogger;

    public binaryType?: BinaryType;

    constructor(public neural: NeuralTransformer) {
        this.binaryType = SOCKET_BINARY_TYPE;
        this.log.info(SocketEvent.Constructor, { binaryType: this.binaryType });
    }

    public get socket(): SocketHandler<Data, 'buffer'> {
        return Proxy.revocable(this, {
            get: (target, key) => {
                const value = Reflect.get(target, key, target);
                if (typeof value !== FUNCTION_TYPE) return value;
                return (value as (...props: unknown[]) => unknown).bind(target);
            },
        }).proxy as SocketHandler<Data, 'buffer'>;
    }

    public async open(socket: Socket<Data>) {
        this.log.info(SocketEvent.Open);
        // this.neural.reflex.next({ action: SocketEvent.Open, data: true });
        socket.write(`${JSON.stringify({ action: SocketEvent.Open, data: true })}\n`);
    }

    public async close(socket: Socket<Data>, error?: Error) {
        this.log.info(SocketEvent.Close, { hasError: error !== undefined });
        if (error) this.log.error(SocketEvent.Close, error);
    }

    public async error(socket: Socket<Data>, error: Error) {
        this.log.error(SocketEvent.Error, error);
    }

    public async data(socket: Socket<Data>, data: Uint8Array) {
        // this.log.debug(SocketEvent.Data, Buffer.from(data).toString());
        this.neural.reflex.next({ action: SocketEvent.Data, data: JSON.parse(Buffer.from(data).toString()) })
    }


    public async drain(socket: Socket<Data>) {
        this.log.debug(SocketEvent.Drain);
    }

    public async handshake(socket: Socket<Data>, success: boolean, authorizationError: Error | null) {
        this.log.info(SocketEvent.Handshake, { success, hasAuthorizationError: authorizationError !== null });
        if (authorizationError) this.log.error(SocketEvent.Handshake, authorizationError);
    }

    public async end(socket: Socket<Data>) {
        this.log.info(SocketEvent.End);
    }

    public async connectError(socket: Socket<Data>, error: Error) {
        this.log.error(SocketEvent.ConnectError, error);
    }

    public async timeout(socket: Socket<Data>) {
        this.log.warn(SocketEvent.Timeout);
    }
}
