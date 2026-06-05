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
 * Result of decoding one raw IPC socket chunk.
 */
export interface PacketDecodeResult<T = unknown> {
    packets: T[];
    errors: PacketDecodeError[];
}

/**
 * One malformed complete frame observed while decoding an IPC stream.
 */
export interface PacketDecodeError {
    frame: string;
    error: Error;
}

/**
 * Per-connection decode state released when its socket closes.
 */
export interface PacketDecodeState {
    decoder: TextDecoder;
    buffer: string;
}
