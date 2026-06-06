import { readFileSync } from 'fs';
import { join } from 'path';
import type { ServerWebSocket } from 'bun';

/**
 * Browser test bridge configuration.
 * `socketEndpoint` is the Flyflor kernel IPC endpoint; `host`/`port` expose the local WebSocket test page.
 */
interface IpcClientBridgeConfig {
    socketEndpoint: string;
    host: string;
    port: number;
    pagePath: string;
}

export enum SocketEvent {
    Constructor = 'constructor',
    Close = 'close',
    Error = 'error',
    Open = 'open',
    User = 'user',
    Agent = 'agent',
    Data = 'data',
    StreamEnd = 'streamEnd',
    Drain = 'drain',
    Handshake = 'handshake',
    End = 'end',
    ConnectError = 'connectError',
    Timeout = 'timeout',
}

/**
 * One IPC frame exchanged with the Flyflor kernel and mirrored to the browser test page.
 */
interface IPCMessage {
    action: SocketEvent;
    data: unknown;
}

/** WebSocket connection state stored by Bun for each browser client. */
interface BrowserSocketData {
    ipc?: Awaited<ReturnType<typeof Bun.connect<undefined>>>;
}

/** Default local host used by the browser test bridge. */
const DEFAULT_HOST = '127.0.0.1';

/** Default WebSocket/HTTP port expected by `web/ipc-test.html`. */
const DEFAULT_PORT = 17878;

/** Public Flyflor kernel socket endpoint used by the test bridge. */
const IPC_SOCKET_ENDPOINT = './flyflor.sock';

/** Relative path to the browser test page. */
const TEST_PAGE_PATH = 'web/ipc-test.html';

/** Number of bytes used by the kernel IPC unsigned big-endian frame length header. */
const PACKET_LENGTH_HEADER_BYTES = 8;

/** Maximum JSON body size accepted from one kernel IPC frame. */
const PACKET_MAX_CONTENT_BYTES = 16 * 1024 * 1024;

/** Text encoding used by the kernel IPC socket stream. */
const PACKET_TEXT_ENCODING = 'utf8';

const config: IpcClientBridgeConfig = {
    socketEndpoint: IPC_SOCKET_ENDPOINT,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    pagePath: join(process.cwd(), TEST_PAGE_PATH),
};

const page = readFileSync(config.pagePath, 'utf8');

const server = Bun.serve<BrowserSocketData>({
    hostname: config.host,
    port: config.port,
    fetch(request, server) {
        if (server.upgrade(request, { data: {} })) {
            return;
        }
        return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },
    websocket: {
        async open(browser) {
            try {
                browser.data.ipc = await connectKernelSocket(browser, config.socketEndpoint);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                browser.send(JSON.stringify({ action: SocketEvent.Error, data: `Kernel socket connection failed: ${message}` } satisfies IPCMessage));
            }
        },
        message(browser, message) {
            const ipc = browser.data.ipc;
            if (ipc === undefined) {
                browser.send(JSON.stringify({ action: SocketEvent.Error, data: 'IPC socket is not connected' } satisfies IPCMessage));
                return;
            }
            ipc.write(encodeFrame(message));
        },
        close(browser) {
            browser.data.ipc?.end();
        },
    },
});

console.log(`[IPC/client] Web test page: http://${server.hostname}:${server.port}`);
console.log(`[IPC/client] WebSocket bridge: ws://${server.hostname}:${server.port}`);
console.log(`[IPC/client] Kernel socket: ${config.socketEndpoint}`);

/**
 * Opens one kernel IPC socket for a browser WebSocket connection.
 * @param browser - Browser-side WebSocket managed by Bun. Kernel replies are forwarded to this socket.
 * @param endpoint - Flyflor kernel unix socket endpoint.
 * @returns Bun socket connected to the kernel.
 */
async function connectKernelSocket(browser: ServerWebSocket<BrowserSocketData>, endpoint: string): Promise<Awaited<ReturnType<typeof Bun.connect<undefined>>>> {
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    return Bun.connect({
        unix: endpoint,
        socket: {
            data(_socket, data) {
                buffer = forwardFrames(browser, buffer, data);
            },
            error(_socket, error) {
                browser.send(JSON.stringify({ action: SocketEvent.Error, data: error.message } satisfies IPCMessage));
            },
            close() {
                browser.close();
            },
        },
    });
}

/**
 * Mirrors length-prefixed kernel IPC frames to the browser WebSocket.
 * @param browser - Browser-side WebSocket.
 * @param pending - Incomplete frame bytes held from earlier chunks.
 * @param data - Raw bytes received from the kernel socket.
 * @returns Remaining incomplete frame bytes after forwarding complete frames.
 */
function forwardFrames(browser: ServerWebSocket<BrowserSocketData>, pending: Buffer<ArrayBufferLike>, data: Uint8Array): Buffer<ArrayBufferLike> {
    let buffer = Buffer.concat([pending, Buffer.from(data)]);
    while (buffer.byteLength >= PACKET_LENGTH_HEADER_BYTES) {
        const contentLength = buffer.readBigUInt64BE(0);
        if (contentLength > BigInt(Number.MAX_SAFE_INTEGER)) {
            browser.send(JSON.stringify({ action: SocketEvent.Error, data: 'IPC frame length exceeds JavaScript safe integer range' } satisfies IPCMessage));
            return Buffer.alloc(0);
        }
        if (contentLength > BigInt(PACKET_MAX_CONTENT_BYTES)) {
            browser.send(JSON.stringify({ action: SocketEvent.Error, data: 'IPC frame length exceeds maximum' } satisfies IPCMessage));
            return Buffer.alloc(0);
        }
        const bodyLength = Number(contentLength);
        const frameLength = PACKET_LENGTH_HEADER_BYTES + bodyLength;
        if (buffer.byteLength < frameLength) {
            break;
        }
        const body = buffer.subarray(PACKET_LENGTH_HEADER_BYTES, frameLength);
        browser.send(body.toString(PACKET_TEXT_ENCODING));
        buffer = Buffer.from(buffer.subarray(frameLength));
    }
    return buffer;
}

/**
 * Converts a browser WebSocket message into one length-prefixed IPC frame.
 * @param message - Raw WebSocket message payload.
 * @returns An 8-byte unsigned big-endian length header followed by UTF-8 JSON bytes.
 */
function encodeFrame(message: string | Buffer): Buffer {
    const body = Buffer.from(typeof message === 'string' ? message : message.toString(PACKET_TEXT_ENCODING), PACKET_TEXT_ENCODING);
    const header = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
    header.writeBigUInt64BE(BigInt(body.byteLength), 0);
    return Buffer.concat([header, body]);
}
