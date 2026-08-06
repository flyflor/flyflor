import type { Socket } from 'bun';
import { FComponent, Provide } from '@/core';
import { HEADER_BYTES, IPCPacket, MAX_BODY_BYTES } from '../packet';
import type { IpcEnvelope } from '../types';

export interface SocketConnectionData {}

export const MAX_CONNECTION_BUFFER_BYTES = 2 * (MAX_BODY_BYTES + HEADER_BYTES);

/**
 * EN: Per-client framing and backpressure state. No buffer is shared between clients.
 * ZH: 单客户端的 framing 与 backpressure 状态；客户端之间不共享任何缓冲。
 */
@Provide()
export class SocketConnection extends FComponent {
    private input: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    private readonly output: Buffer<ArrayBufferLike>[] = [];
    private intake: Promise<void> = Promise.resolve();
    private pendingInputBytes = 0;
    private pendingOutputBytes = 0;
    private closed = false;

    constructor(
        public readonly socket: Socket<SocketConnectionData>,
        public readonly id: string,
        private readonly packet: IPCPacket,
    ) {
        super();
    }

    public read(data: Uint8Array): IpcEnvelope[] {
        if (this.input.byteLength + data.byteLength > MAX_CONNECTION_BUFFER_BYTES) {
            throw this.fail(`Connection input buffer exceeds ${MAX_CONNECTION_BUFFER_BYTES} bytes`);
        }
        try {
            const result = this.packet.read(this.input, data);
            this.input = result.pending;
            return result.packets.map((packet) => this.packet.decode<IpcEnvelope>(packet));
        } catch (error) {
            this.input = Buffer.alloc(0);
            throw error;
        }
    }

    public receive(
        data: Uint8Array,
        dispatch: (envelope: IpcEnvelope) => Promise<void>,
        reject: (error: unknown) => void,
    ): Promise<void> {
        const chunk = Buffer.from(data);
        if (this.input.byteLength + this.pendingInputBytes + chunk.byteLength > MAX_CONNECTION_BUFFER_BYTES) {
            return Promise.reject(this.fail(`Connection input buffer exceeds ${MAX_CONNECTION_BUFFER_BYTES} bytes`));
        }
        this.pendingInputBytes += chunk.byteLength;
        const received = this.intake.then(async () => {
            if (this.closed) return;
            let packets: Uint8Array[];
            try {
                const result = this.packet.read(this.input, chunk);
                this.input = result.pending;
                packets = result.packets;
            } catch (error) {
                this.input = Buffer.alloc(0);
                throw error;
            }
            for (const packet of packets) {
                if (this.closed) return;
                try {
                    await dispatch(this.packet.decode<IpcEnvelope>(packet));
                } catch (error) {
                    reject(error);
                }
            }
        }).finally(() => {
            this.pendingInputBytes = Math.max(0, this.pendingInputBytes - chunk.byteLength);
        });
        this.intake = received.then(() => undefined, () => undefined);
        return received;
    }

    public write(envelope: IpcEnvelope): void {
        if (this.closed) return;
        const packet = this.packet.encode(envelope);
        if (this.pendingOutputBytes + packet.byteLength > MAX_CONNECTION_BUFFER_BYTES) {
            throw this.fail(`Connection output buffer exceeds ${MAX_CONNECTION_BUFFER_BYTES} bytes`);
        }
        this.output.push(packet);
        this.pendingOutputBytes += packet.byteLength;
        this.flush();
    }

    public drain(): void {
        this.flush();
    }

    public close(): void {
        this.closed = true;
        this.input = Buffer.alloc(0);
        this.output.splice(0);
        this.pendingOutputBytes = 0;
    }

    private flush(): void {
        while (this.output.length > 0) {
            const current = this.output[0]!;
            const written = this.socket.write(current);
            if (written < 0) return;
            if (written === current.byteLength) {
                this.output.shift();
                this.pendingOutputBytes = Math.max(0, this.pendingOutputBytes - current.byteLength);
                continue;
            }
            if (written > 0) {
                this.output[0] = current.subarray(written);
                this.pendingOutputBytes = Math.max(0, this.pendingOutputBytes - written);
            }
            return;
        }
    }

    private fail(message: string): Error {
        const error = Error(message);
        this.close();
        try {
            this.socket.end();
        } catch (reason) {
            this.log.error('ipc.connection.end', reason);
        }
        return error;
    }
}
