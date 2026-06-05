import { FService, Service } from '@/core';
import { PACKET_LENGTH_HEADER_BYTES, PACKET_MAX_CONTENT_BYTES, PACKET_TEXT_ENCODING } from './packet.constants';
import type { PacketDecodeError, PacketDecodeResult, PacketDecodeState, SocketPacket } from './packet.types';

/**
 * Encodes and decodes 8-byte big-endian length-prefixed JSON IPC frames.
 *
 * Bun may deliver partial frames, multiple frames in one chunk, or split a multibyte UTF-8 sequence across
 * chunks. This service keeps decode state per socket connection so the singleton socket handler never shares
 * a buffer between clients.
 */
@Service()
export class PacketService extends FService {
    private readonly states = new Map<object, PacketDecodeState>();

    /**
     * Serializes one packet into an 8-byte length header followed by UTF-8 JSON bytes.
     * @param packet - Packet payload to write to the IPC socket.
     * @returns Binary IPC frame with a big-endian unsigned int64 byte-length header.
     */
    public encode(packet: SocketPacket): Buffer {
        const content = JSON.stringify(packet);
        const body = Buffer.from(content, PACKET_TEXT_ENCODING);
        if (body.byteLength > PACKET_MAX_CONTENT_BYTES) {
            throw Object.assign(Error('Packet content length exceeds maximum'), {
                detail: { byteLength: body.byteLength, maxBytes: PACKET_MAX_CONTENT_BYTES },
            });
        }
        const header = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
        header.writeBigUInt64BE(BigInt(body.byteLength), 0);
        return Buffer.concat([header, body]);
    }

    /**
     * Decodes a socket data chunk into zero or more complete length-prefixed JSON frames.
     * @param connection - Stable connection object used as the decode-state key.
     * @param data - Raw bytes delivered by Bun.
     * @returns Parsed packets plus malformed complete frames, if any.
     */
    public decode<T = unknown>(connection: object, data: Uint8Array): PacketDecodeResult<T> {
        const state = this.useState(connection);
        state.buffer = Buffer.concat([state.buffer, Buffer.from(data)]);
        return this.drainFrames<T>(state);
    }

    /**
     * Releases decode state for a closing socket.
     * @param connection - Stable connection object previously passed to `decode()`.
     * @returns A short description of any non-empty partial frame left in the connection buffer.
     */
    public close(connection: object): string | undefined {
        const state = this.states.get(connection);
        if (state === undefined) {
            return undefined;
        }
        this.states.delete(connection);
        return state.buffer.byteLength === 0 ? undefined : this.describeBytes(state.buffer);
    }

    private useState(connection: object): PacketDecodeState {
        const existing = this.states.get(connection);
        if (existing !== undefined) {
            return existing;
        }
        const state: PacketDecodeState = {
            decoder: new TextDecoder(PACKET_TEXT_ENCODING),
            buffer: Buffer.alloc(0),
        };
        this.states.set(connection, state);
        return state;
    }

    private drainFrames<T>(state: PacketDecodeState): PacketDecodeResult<T> {
        const packets: T[] = [];
        const errors: PacketDecodeError[] = [];

        while (state.buffer.byteLength >= PACKET_LENGTH_HEADER_BYTES) {
            const contentLength = state.buffer.readBigUInt64BE(0);
            if (contentLength > BigInt(Number.MAX_SAFE_INTEGER) || contentLength > BigInt(PACKET_MAX_CONTENT_BYTES)) {
                errors.push({
                    frame: this.describeHeader(state.buffer, contentLength),
                    error: Object.assign(Error('Packet content length exceeds maximum'), {
                        detail: { byteLength: contentLength.toString(), maxBytes: PACKET_MAX_CONTENT_BYTES },
                    }),
                });
                state.buffer = Buffer.alloc(0);
                break;
            }
            const bodyLength = Number(contentLength);
            const frameLength = PACKET_LENGTH_HEADER_BYTES + bodyLength;
            if (state.buffer.byteLength < frameLength) {
                break;
            }
            const body = state.buffer.subarray(PACKET_LENGTH_HEADER_BYTES, frameLength);
            state.buffer = Buffer.from(state.buffer.subarray(frameLength));
            try {
                const frame = state.decoder.decode(body);
                packets.push(JSON.parse(frame) as T);
            } catch (error) {
                errors.push({
                    frame: this.describeBytes(body),
                    error: error instanceof Error ? error : Error(String(error)),
                });
            }
        }

        return { packets, errors };
    }

    private describeHeader(buffer: Buffer, contentLength: bigint): string {
        const header = buffer.subarray(0, PACKET_LENGTH_HEADER_BYTES).toString('hex');
        return `length=${contentLength.toString()}, header=${header}`;
    }

    private describeBytes(buffer: Uint8Array): string {
        const previewLength = Math.min(buffer.byteLength, 128);
        const preview = Buffer.from(buffer.subarray(0, previewLength)).toString(PACKET_TEXT_ENCODING);
        return buffer.byteLength > previewLength ? `${preview}... (${buffer.byteLength} bytes)` : preview;
    }
}
