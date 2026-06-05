/** Number of bytes used by the unsigned big-endian frame length header. */
export const PACKET_LENGTH_HEADER_BYTES = 8;

/** Maximum JSON body size accepted from one IPC frame. */
export const PACKET_MAX_CONTENT_BYTES = 16 * 1024 * 1024;

/** Text encoding used by the IPC socket stream. */
export const PACKET_TEXT_ENCODING = 'utf-8';
