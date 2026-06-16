import { FService, Logger, Service, type FLogger } from '@/core';
import { PACKET_LENGTH_HEADER_BYTES, PACKET_PROTOCOL_MISMATCH_MESSAGE, PACKET_TEXT_ENCODING } from './constants';
import type { PacketDecodeError, PacketDecodeResult, PacketDecodeState, SocketPacket } from './types';

/**
 * Encodes and decodes 8-byte big-endian length-prefixed JSON IPC packets.
 *
 * Bun may deliver partial packets, multiple packets in one chunk, or split a multibyte UTF-8 sequence across
 * chunks. This service keeps decode state per socket connection so the singleton socket handler never shares
 * a buffer between clients.
 */
@Service()
export class PacketService extends FService {
    @Logger(PacketService.name)
    public readonly log!: FLogger;

    private readonly states = new Map<object, PacketDecodeState>();

    /**
     * Serializes one packet into an 8-byte length header followed by UTF-8 JSON bytes.
     * @param packet - Packet payload to write to the IPC socket.
     * @returns Binary IPC packet with a big-endian unsigned int64 byte-length header.
     */
    public encode(packet: SocketPacket<unknown>): Buffer {
        const content = JSON.stringify(packet);
        const body = Buffer.from(content, PACKET_TEXT_ENCODING);
        const header = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
        header.writeBigUInt64BE(BigInt(body.byteLength), 0);
        return Buffer.concat([header, body]);
    }

    /**
     * Decodes a socket data chunk into zero or more complete length-prefixed JSON packets.
     * @param connection - Stable connection object used as the decode-state key.
     * @param data - Raw bytes delivered by Bun.
     * @returns Parsed packets plus malformed complete packets, if any.
     */
    public decode<T = unknown>(connection: object, data: Uint8Array): PacketDecodeResult<T> {
        const state = this.useState(connection);
        this.log.debug('[IPC/kernel] packet.decode.chunk', {
            chunkBytes: data.byteLength,
            bufferedBefore: state.buffer.byteLength,
            hex: this.describeHex(data),
            textPreview: this.describeBytes(data),
        });
        state.buffer = Buffer.concat([state.buffer, Buffer.from(data)]);
        const result = this.drainPackets<T>(state);
        this.log.debug('[IPC/kernel] packet.decode.result', {
            packets: result.packets.length,
            errors: result.errors.map((item) => item.error.message),
            bufferedAfter: state.buffer.byteLength,
        });
        return result;
    }

    /**
     * Releases decode state for a closing socket.
     * @param connection - Stable connection object previously passed to `decode()`.
     * @returns A short description of any non-empty partial packet left in the connection buffer.
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

    private drainPackets<T>(state: PacketDecodeState): PacketDecodeResult<T> {
        const packets: T[] = [];
        const errors: PacketDecodeError[] = [];

        while (state.buffer.byteLength >= PACKET_LENGTH_HEADER_BYTES) {
            if (this.looksLikeTextProtocol(state.buffer)) {
                this.log.debug('[IPC/kernel] packet.decode.protocol-mismatch', {
                    bytes: state.buffer.byteLength,
                    hex: this.describeHex(state.buffer),
                    preview: this.describeBytes(state.buffer),
                });
                errors.push({
                    packet: this.describeBytes(state.buffer),
                    error: Error(PACKET_PROTOCOL_MISMATCH_MESSAGE),
                });
                state.buffer = Buffer.alloc(0);
                break;
            }
            const contentLength = state.buffer.readBigUInt64BE(0);
            this.log.debug('[IPC/kernel] packet.decode.header', {
                declaredBodyBytes: contentLength.toString(),
                bufferedBytes: state.buffer.byteLength,
                headerHex: this.describeHex(state.buffer, PACKET_LENGTH_HEADER_BYTES),
            });
            if (contentLength > BigInt(Number.MAX_SAFE_INTEGER)) {
                errors.push({
                    packet: this.describeHeader(state.buffer, contentLength),
                    error: Object.assign(Error('Packet content length exceeds JavaScript safe integer range'), {
                        detail: { byteLength: contentLength.toString(), maxBytes: Number.MAX_SAFE_INTEGER },
                    }),
                });
                state.buffer = Buffer.alloc(0);
                break;
            }
            const bodyLength = Number(contentLength);
            const packetLength = PACKET_LENGTH_HEADER_BYTES + bodyLength;
            if (state.buffer.byteLength < packetLength) {
                break;
            }
            const body = state.buffer.subarray(PACKET_LENGTH_HEADER_BYTES, packetLength);
            state.buffer = Buffer.from(state.buffer.subarray(packetLength));
            try {
                const content = state.decoder.decode(body);
                this.log.debug('[IPC/kernel] packet.decode.body', {
                    bodyBytes: body.byteLength,
                    preview: this.describeText(content),
                    remainingBytes: state.buffer.byteLength,
                });
                packets.push(JSON.parse(content) as T);
            } catch (error) {
                this.log.debug('[IPC/kernel] packet.decode.json-error', {
                    bodyBytes: body.byteLength,
                    hex: this.describeHex(body),
                    preview: this.describeBytes(body),
                    message: error instanceof Error ? error.message : String(error),
                });
                errors.push({
                    packet: this.describeBytes(body),
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
        const preview = this.describeText(Buffer.from(buffer.subarray(0, previewLength)).toString(PACKET_TEXT_ENCODING));
        return buffer.byteLength > previewLength ? `${preview}... (${buffer.byteLength} bytes)` : preview;
    }

    private describeText(value: string): string {
        return value.replace(/\0/g, '\\0');
    }

    private describeHex(buffer: Uint8Array, max = 16): string {
        return Buffer.from(buffer.subarray(0, max)).toString('hex');
    }

    private looksLikeTextProtocol(buffer: Buffer): boolean {
        let index = 0;
        while (index < buffer.byteLength) {
            const byte = buffer[index];
            if (byte === undefined) return false;
            if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
                index += 1;
                continue;
            }
            return byte === 0x7b || byte === 0x5b || byte >= 0x20;
        }
        return false;
    }
}
