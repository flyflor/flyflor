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
    private readonly pendingWrites = new WeakMap<Socket<SocketConnectionData>, Buffer[]>();

    public open = async (socket: Socket<SocketConnectionData>) => {
        this.log.info(SocketEvent.Open);
        this.queueWrite(socket, this.packet.encode({ action: SocketEvent.Open, data: true }));
    };

    public close = async (socket: Socket<SocketConnectionData>, error?: Error) => {
        const partialPacket = this.packet.close(socket);
        this.pendingWrites.delete(socket);
        this.log.info(SocketEvent.Close, { hasError: error !== undefined });
        if (partialPacket !== undefined) this.log.warn(SocketEvent.Close, { partialPacket });
        if (error) this.log.error(SocketEvent.Close, error);
    };

    public error = async (_socket: Socket<SocketConnectionData>, error: Error) => {
        this.log.error(SocketEvent.Error, error);
    };

    public data = async (socket: Socket<SocketConnectionData>, data: Uint8Array) => {
        this.log.debug('input', data);
        const { packets, errors } = this.packet.decode<SocketPacket>(socket, data);
        this.log.debug('[IPC/kernel] socket.data.decode', {
            chunkBytes: data.byteLength,
            packets: packets.length,
            errors: errors.map((item) => item.error.message),
        });
        // Malformed complete packets: report each, without blocking valid packets in the same chunk.
        for (const { error } of errors) {
            this.log.debug('[IPC/kernel] socket.data.error-response', {
                source: 'kernel.decode',
                message: error.message,
            });
            this.queueWrite(socket, this.packet.encode({ action: SocketEvent.Error, data: error.message }));
        }
        // Scope this turn's streamed chunks to the requesting socket for as long as the turn runs.
        const subscription = this.synapse.agent.subscribe((content) => {
            this.queueWrite(socket, this.packet.encode({ action: SocketEvent.Data, data: content }));
        });
        try {
            // Route valid packets one at a time so a turn's streamEnd is written before the next packet starts.
            for (const packet of packets) {
                this.log.debug('[IPC/kernel] socket.data.packet', this.describePacket(packet));
                await this.synapse.next(packet);
                this.queueWrite(socket, this.packet.encode({ action: SocketEvent.StreamEnd, data: true }));
            }
        } catch (error) {
            const cause = error instanceof Error ? error : Error(String(error));
            this.log.error(SocketEvent.Data, cause);
            this.queueWrite(socket, this.packet.encode({ action: SocketEvent.Error, data: cause.message }));
        } finally {
            subscription.unsubscribe();
        }
    };

    public drain = (socket: Socket<SocketConnectionData>) => {
        this.log.debug('[IPC/kernel] socket.drain');
        this.flushPendingWrites(socket);
    };

    private describePacket(packet: SocketPacket): Record<string, unknown> {
        const data = packet.data;
        if (typeof data === 'string') {
            return {
                action: packet.action,
                dataType: 'string',
                dataLength: data.length,
                dataPreview: data.length > 160 ? `${data.slice(0, 160)}...` : data,
            };
        }
        if (data !== null && typeof data === 'object') {
            const text = (data as { text?: unknown }).text;
            return {
                action: packet.action,
                dataType: 'object',
                textLength: typeof text === 'string' ? text.length : undefined,
                keys: Object.keys(data as Record<string, unknown>),
            };
        }
        return {
            action: packet.action,
            dataType: typeof data,
        };
    }

    private queueWrite(socket: Socket<SocketConnectionData>, data: Buffer): void {
        const queue = this.useWriteQueue(socket);
        if (queue.length === 0) {
            const written = socket.write(data);
            if (written === data.byteLength) {
                return;
            }
            if (written > 0) {
                queue.push(data.subarray(written));
            } else if (written === 0) {
                queue.push(data);
            } else {
                this.log.warn('[IPC/kernel] socket.write.closed');
                return;
            }
            this.log.debug('[IPC/kernel] socket.write.backpressure', {
                written,
                pendingBytes: this.pendingBytes(queue),
            });
            return;
        }
        queue.push(data);
        this.log.debug('[IPC/kernel] socket.write.queue', {
            pendingBytes: this.pendingBytes(queue),
        });
    }

    private flushPendingWrites(socket: Socket<SocketConnectionData>): void {
        const queue = this.useWriteQueue(socket);
        while (queue.length > 0) {
            const next = queue[0];
            if (next === undefined) break;
            const written = socket.write(next);
            if (written < 0) {
                this.log.warn('[IPC/kernel] socket.write.closed');
                return;
            }
            if (written < next.byteLength) {
                queue[0] = next.subarray(written);
                this.log.debug('[IPC/kernel] socket.write.partial', {
                    written,
                    remainingBytes: this.pendingBytes(queue),
                });
                return;
            }
            queue.shift();
        }
    }

    private useWriteQueue(socket: Socket<SocketConnectionData>): Buffer[] {
        const existing = this.pendingWrites.get(socket);
        if (existing !== undefined) return existing;
        const queue: Buffer[] = [];
        this.pendingWrites.set(socket, queue);
        return queue;
    }

    private pendingBytes(queue: Buffer[]): number {
        return queue.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    }
}
