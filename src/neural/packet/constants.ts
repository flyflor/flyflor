/** Number of bytes used by the unsigned big-endian packet body length header. */
export const PACKET_LENGTH_HEADER_BYTES = 8;

/** Text encoding used by the IPC socket stream. */
export const PACKET_TEXT_ENCODING = 'utf-8';

/** Error text used when a non-IPC JSON/text payload is sent to the packet decoder. */
export const PACKET_PROTOCOL_MISMATCH_MESSAGE = 'Invalid IPC packet: expected 8-byte length-prefixed JSON packet';
