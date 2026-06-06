import { Inject, Logger, Singleton, type FLogger } from '@/core';
import { Synapse } from '@/neural/synapse';
import { PacketService, SocketEvent, type SocketPacket } from '@/neural/packet';
import type { BinaryType, Socket, SocketHandler } from 'bun';
import { catchError, concatMap, defaultIfEmpty, EMPTY, from, ignoreElements, lastValueFrom, map, tap, type Subscription } from 'rxjs';

const SOCKET_BINARY_TYPE: BinaryType = 'buffer';
const FUNCTION_TYPE = 'function';

export { SocketEvent, type SocketPacket } from '@/neural/packet';

export interface SocketConnectionData {
    subscription?: Subscription;
}

/**
 * Bun socket handler used by IPCService.
 *
 * The class owns socket lifecycle callbacks only: connection open/close, inbound data, backpressure,
 * handshake, timeout, and transport errors. Each callback logs its lifecycle event so IPC socket behavior
 * can be traced without changing the wire protocol.
 */
@Singleton()
export class FSocket implements SocketHandler<SocketConnectionData, 'buffer'> {
    @Logger(FSocket.name)
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

    public get socket(): SocketHandler<SocketConnectionData, 'buffer'> {
        return Proxy.revocable(this, {
            get: (target, key) => {
                const value = Reflect.get(target, key, target);
                if (typeof value !== FUNCTION_TYPE) return value;
                return (value as (...props: unknown[]) => unknown).bind(target);
            },
        }).proxy as SocketHandler<SocketConnectionData, 'buffer'>;
    }

    public async open(socket: Socket<SocketConnectionData>) {
        this.log.info(SocketEvent.Open);
        // Socket open owns the stream subscription; data() only triggers agent work.
        socket.data = socket.data ?? {};
        socket.data.subscription?.unsubscribe();
        socket.data.subscription = this.synapse.agent.subscribe(content => {
            this.log.debug('output', content);
            socket.write(this.packet.encode({ action: SocketEvent.Data, data: content }));
        });
        socket.write(this.packet.encode({ action: SocketEvent.Open, data: true }));
    }

    public async close(socket: Socket<SocketConnectionData>, error?: Error) {
        // Release the per-connection subscription so reconnects do not keep stale writers alive.
        socket.data?.subscription?.unsubscribe();
        if (socket.data !== undefined) socket.data.subscription = undefined;
        const partialFrame = this.packet.close(socket);
        this.log.info(SocketEvent.Close, { hasError: error !== undefined });
        if (partialFrame !== undefined) this.log.warn(SocketEvent.Close, { partialFrame });
        if (error) this.log.error(SocketEvent.Close, error);
    }

    public async error(socket: Socket<SocketConnectionData>, error: Error) {
        this.log.error(SocketEvent.Error, error);
    }

    public async data(socket: Socket<SocketConnectionData>, data: Uint8Array) {
        this.log.debug('input', data);
        // Command path only: decoded packets trigger Synapse, streamed output arrives through the open() subscription.
        await lastValueFrom(
            from([data]).pipe(
                map((chunk) => this.packet.decode<SocketPacket>(socket, chunk)),
                tap(({ errors = [] }) => {
                    for (const { error } of errors) {
                        socket.write(this.packet.encode({ action: SocketEvent.Error, data: error.message }));
                    }
                }),
                concatMap(({ packets }) => from(packets)),
                concatMap((packet) => from(this.synapse.next(packet))),
                ignoreElements(),
                catchError(error => {
                    const cause = error instanceof Error ? error : Error(String(error));
                    this.log.error(SocketEvent.Data, cause);
                    socket.write(this.packet.encode({ action: SocketEvent.Error, data: cause.message }));
                    return EMPTY;
                }),
                defaultIfEmpty(undefined),
            )
        );
    }
}
