import { FService, Service } from '@/core';
import { PACKET_FRAME_SEPARATOR, PACKET_TEXT_ENCODING } from './packet.constants';
import type { PacketDecodeError, PacketDecodeResult, PacketDecodeState, SocketPacket } from './packet.types';

/**
 * Encodes and decodes newline-delimited JSON IPC frames.
 *
 * Bun may deliver partial frames, multiple frames in one chunk, or split a multibyte UTF-8 sequence across
 * chunks. This service keeps decode state per socket connection so the singleton socket handler never shares
 * a buffer between clients.
 */
@Service()
export class PacketService extends FService {
    private readonly states = new Map<object, PacketDecodeState>();

    /**
     * Serializes one packet into a newline-terminated JSON frame.
     * @param packet - Packet payload to write to the IPC socket.
     * @returns UTF-8 JSON text with the canonical frame separator appended.
     */
    public encode(packet: SocketPacket): string {
        return JSON.stringify(packet) + PACKET_FRAME_SEPARATOR;
    }

    /**
     * Decodes a socket data chunk into zero or more complete JSON frames.
     * @param connection - Stable connection object used as the decode-state key.
     * @param data - Raw bytes delivered by Bun.
     * @returns Parsed packets plus malformed complete frames, if any.
     */
    public decode<T = unknown>(connection: object, data: Uint8Array): PacketDecodeResult<T> {
        const state = this.useState(connection);
        state.buffer += state.decoder.decode(data, { stream: true });
        return this.drainFrames<T>(state);
    }

    /**
     * Releases decode state for a closing socket.
     * @param connection - Stable connection object previously passed to `decode()`.
     * @returns Any non-empty partial frame left in the connection buffer.
     */
    public close(connection: object): string | undefined {
        const state = this.states.get(connection);
        if (state === undefined) {
            return undefined;
        }
        state.buffer += state.decoder.decode();
        this.states.delete(connection);
        const trimmed = state.buffer.trim();
        return trimmed.length === 0 ? undefined : trimmed;
    }

    private useState(connection: object): PacketDecodeState {
        const existing = this.states.get(connection);
        if (existing !== undefined) {
            return existing;
        }
        const state: PacketDecodeState = {
            decoder: new TextDecoder(PACKET_TEXT_ENCODING),
            buffer: '',
        };
        this.states.set(connection, state);
        return state;
    }

    private drainFrames<T>(state: PacketDecodeState): PacketDecodeResult<T> {
        const frames = state.buffer.split(PACKET_FRAME_SEPARATOR);
        state.buffer = frames.pop() ?? '';
        const packets: T[] = [];
        const errors: PacketDecodeError[] = [];

        for (const frame of frames) {
            const trimmed = frame.trim();
            if (trimmed.length === 0) {
                continue;
            }
            try {
                packets.push(JSON.parse(trimmed) as T);
            } catch (error) {
                errors.push({
                    frame: trimmed,
                    error: error instanceof Error ? error : Error(String(error)),
                });
            }
        }

        return { packets, errors };
    }
}
