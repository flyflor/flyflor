import { Inject, Logger, Singleton, type FLogger } from '@/core';
import { Synapse } from '@/neural/synapse';
import { PacketService, SocketEvent, type SocketPacket } from '@/neural/packet';
import type { BinaryType, Socket, SocketHandler } from 'bun';

export interface SocketConnectionData {}

/**
 * Bun socket handler used by IPCService.
 *
 * The class owns socket lifecycle callbacks only: connection open/close, inbound data, and transport
 * errors. Handlers are arrow-function fields so `this` is the FSocket instance however Bun invokes
 * them; the instance is passed straight to `Bun.listen({ socket })`.
 */
@Singleton()
export class FSocket implements SocketHandler<SocketConnectionData, 'buffer'> {
    @Logger(FSocket.name)
    public readonly log!: FLogger;

    @Inject()
    public synapse!: Synapse;

    @Inject()
    public packet!: PacketService;

    public binaryType: BinaryType = 'buffer';

    public open = async (socket: Socket<SocketConnectionData>) => {
        this.log.info(SocketEvent.Open);
        socket.write(this.packet.encode({ action: SocketEvent.Open, data: true }));
    };

    public close = async (socket: Socket<SocketConnectionData>, error?: Error) => {
        const partialFrame = this.packet.close(socket);
        this.log.info(SocketEvent.Close, { hasError: error !== undefined });
        if (partialFrame !== undefined) this.log.warn(SocketEvent.Close, { partialFrame });
        if (error) this.log.error(SocketEvent.Close, error);
    };

    public error = async (_socket: Socket<SocketConnectionData>, error: Error) => {
        this.log.error(SocketEvent.Error, error);
    };

    public data = async (socket: Socket<SocketConnectionData>, data: Uint8Array) => {
        this.log.debug('input', data);
        const { packets, errors } = this.packet.decode<SocketPacket>(socket, data);
        // Malformed complete frames: report each, without blocking the valid frames in the same chunk.
        for (const { error } of errors) {
            socket.write(this.packet.encode({ action: SocketEvent.Error, data: error.message }));
        }
        // Scope this turn's streamed chunks to the requesting socket for as long as the turn runs.
        const subscription = this.synapse.agent.subscribe((content) => {
            socket.write(this.packet.encode({ action: SocketEvent.Data, data: content }));
        });
        try {
            // Route valid frames one at a time so a turn's streamEnd is written before the next frame starts.
            for (const packet of packets) {
                await this.synapse.next(packet);
                socket.write(this.packet.encode({ action: SocketEvent.StreamEnd, data: true }));
            }
        } catch (error) {
            const cause = error instanceof Error ? error : Error(String(error));
            this.log.error(SocketEvent.Data, cause);
            socket.write(this.packet.encode({ action: SocketEvent.Error, data: cause.message }));
        } finally {
            subscription.unsubscribe();
        }
    };
}
