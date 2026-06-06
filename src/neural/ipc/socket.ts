import { Inject, Logger, Singleton, type FLogger } from '@/core';
import { Synapse } from '@/neural/synapse';
import { PacketService, SocketEvent, type SocketPacket } from '@/neural/packet';
import type { BinaryType, Socket, SocketHandler } from 'bun';
import { catchError, EMPTY, from, map, mergeMap, tap } from 'rxjs';

const SOCKET_LOG_SCOPE = 'IPC.Socket';
const SOCKET_BINARY_TYPE: BinaryType = 'buffer';
const FUNCTION_TYPE = 'function';

export { SocketEvent, type SocketPacket } from '@/neural/packet';

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

    @Inject()
    public synapse!: Synapse;

    @Inject()
    public packet!: PacketService;

    public binaryType?: BinaryType;

    constructor() {
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
        socket.write(this.packet.encode({ action: SocketEvent.Open, data: true }));
    }

    public async close(socket: Socket<Data>, error?: Error) {
        const partialFrame = this.packet.close(socket);
        this.log.info(SocketEvent.Close, { hasError: error !== undefined });
        if (partialFrame !== undefined) this.log.warn(SocketEvent.Close, { partialFrame });
        if (error) this.log.error(SocketEvent.Close, error);
    }

    public async error(socket: Socket<Data>, error: Error) {
        this.log.error(SocketEvent.Error, error);
    }

    public async data(socket: Socket<Data>, data: Uint8Array) {
        this.log.debug('input', data);
        this.synapse.pipe(
            map(() => this.packet.decode<SocketPacket>(socket, data)),
            tap(({ errors = [] }) => errors.map(({ error }) => {
                return socket.write(this.packet.encode({ action: SocketEvent.Error, data: error.message }));
            })),
            mergeMap(({ packets }) => from(packets)),
            catchError(error => {
                this.log.error(SocketEvent.Data, error);
                socket.write(this.packet.encode({ action: SocketEvent.Error, data: error.message }));
                return EMPTY;
            })
        ).subscribe(response => {
            this.log.debug('output', response);
            socket.write(this.packet.encode(response));
        });
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
