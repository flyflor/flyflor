import { readFileSync } from 'fs';
import { join } from 'path';
import type { ServerWebSocket } from 'bun';

/**
 * Browser test bridge configuration.
 * `socketEndpoint` is the Flyflor kernel IPC endpoint; `host`/`port` expose the local WebSocket test page.
 */
export interface IpcClientBridgeConfig {
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
 * One JSON packet exchanged with the Flyflor kernel and mirrored to the browser test page.
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
export const DEFAULT_HOST = '127.0.0.1';

/** Default WebSocket/HTTP port expected by `web/client.html`. */
export const DEFAULT_PORT = 17878;

/** Public Flyflor kernel socket endpoint used by the test bridge. */
export const IPC_SOCKET_ENDPOINT = './flyflor.sock';

/** Relative path to the browser test page. */
export const TEST_PAGE_PATH = 'web/client.html';

/** Number of bytes used by the kernel IPC unsigned big-endian packet body length header. */
export const PACKET_LENGTH_HEADER_BYTES = 8;

/** Text encoding used by the kernel IPC socket stream. */
export const PACKET_TEXT_ENCODING = 'utf8';

/** Error text used when a browser client sends binary data to the JSON-only bridge. */
export const BROWSER_JSON_ONLY_MESSAGE = 'Browser bridge accepts JSON text messages only';

/** Error text used when a text payload is observed where a length-prefixed packet is expected. */
export const PACKET_PROTOCOL_MISMATCH_MESSAGE = 'Invalid IPC packet: expected 8-byte length-prefixed JSON packet';

/** Error text used when a declared packet body length is not usable by the bridge. */
export const PACKET_LENGTH_INVALID_MESSAGE = 'IPC packet body length is invalid';

/** Enables local IPC bridge diagnostics unless explicitly disabled. */
const IPC_DEBUG = process.env.NODE_ENV !== 'test' && process.env.FLYFLOR_IPC_DEBUG !== '0';

export interface PacketTextDecodeResult {
    packets: string[];
    errors: string[];
    pending: Buffer<ArrayBufferLike>;
}

const DEFAULT_CONFIG: IpcClientBridgeConfig = {
    socketEndpoint: IPC_SOCKET_ENDPOINT,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    pagePath: join(process.cwd(), TEST_PAGE_PATH),
};

function startIpcClientBridge(options: Partial<IpcClientBridgeConfig> = {}) {
    const config: IpcClientBridgeConfig = { ...DEFAULT_CONFIG, ...options };
    const page = readFileSync(config.pagePath, PACKET_TEXT_ENCODING);

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
                    sendBrowserError(browser, `Kernel socket connection failed: ${messageFromError(error)}`);
                }
            },
            message(browser, message) {
                const ipc = browser.data.ipc;
                debugBridge('browser.in', describeBrowserMessage(message));
                if (ipc === undefined) {
                    sendBrowserError(browser, 'IPC socket is not connected');
                    return;
                }
                try {
                    const encoded = encodeBrowserMessage(message);
                    debugBridge('kernel.out', {
                        bytes: encoded.byteLength,
                        headerHex: previewHex(encoded, PACKET_LENGTH_HEADER_BYTES),
                        bodyPreview: previewText(encoded.subarray(PACKET_LENGTH_HEADER_BYTES).toString(PACKET_TEXT_ENCODING)),
                    });
                    ipc.write(encoded);
                } catch (error) {
                    sendBrowserError(browser, messageFromError(error));
                }
            },
            close(browser) {
                browser.data.ipc?.end();
            },
        },
    });

    console.log(`[IPC/client] Web test page: http://${server.hostname}:${server.port}`);
    console.log(`[IPC/client] WebSocket bridge: ws://${server.hostname}:${server.port}`);
    console.log(`[IPC/client] Kernel socket: ${config.socketEndpoint}`);

    return server;
}

if (import.meta.main) {
    startIpcClientBridge();
}

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
                debugBridge('kernel.in.chunk', {
                    chunkBytes: data.byteLength,
                    pendingBefore: buffer.byteLength,
                    hex: previewHex(data),
                    textPreview: previewText(Buffer.from(data).toString(PACKET_TEXT_ENCODING)),
                });
                buffer = forwardPackets(browser, buffer, data);
                debugBridge('kernel.in.pending', { pendingAfter: buffer.byteLength });
            },
            error(_socket, error) {
                debugBridge('kernel.error', { message: error.message });
                sendBrowserError(browser, error.message);
            },
            close() {
                debugBridge('kernel.close');
                browser.close();
            },
        },
    });
}

/**
 * Mirrors length-prefixed kernel IPC packets to the browser WebSocket.
 * @param browser - Browser-side WebSocket.
 * @param pending - Incomplete packet bytes held from earlier chunks.
 * @param data - Raw bytes received from the kernel socket.
 * @returns Remaining incomplete packet bytes after forwarding complete packets.
 */
function forwardPackets(browser: ServerWebSocket<BrowserSocketData>, pending: Buffer<ArrayBufferLike>, data: Uint8Array): Buffer<ArrayBufferLike> {
    const result = decodePacketTexts(pending, data);
    debugBridge('kernel.in.decode', {
        packets: result.packets.length,
        errors: result.errors,
        pending: result.pending.byteLength,
    });
    for (const packet of result.packets) {
        debugBridge('browser.out', {
            bytes: Buffer.byteLength(packet, PACKET_TEXT_ENCODING),
            preview: previewText(packet),
        });
        browser.send(packet);
    }
    for (const error of result.errors) {
        sendBrowserError(browser, error);
    }
    return result.pending;
}

/**
 * Decodes length-prefixed kernel IPC packet bytes into JSON packet strings for browser WebSocket clients.
 * @param pending - Incomplete packet bytes held from earlier chunks.
 * @param data - Raw bytes received from the kernel socket.
 * @returns Complete JSON packet strings, decode errors, and remaining incomplete packet bytes.
 */
function decodePacketTexts(pending: Buffer<ArrayBufferLike>, data: Uint8Array): PacketTextDecodeResult {
    let buffer = Buffer.concat([pending, Buffer.from(data)]);
    const packets: string[] = [];
    const errors: string[] = [];

    while (buffer.byteLength >= PACKET_LENGTH_HEADER_BYTES) {
        if (looksLikeTextProtocol(buffer)) {
            errors.push(PACKET_PROTOCOL_MISMATCH_MESSAGE);
            return { packets, errors, pending: Buffer.alloc(0) };
        }
        const contentLength = buffer.readBigUInt64BE(0);
        if (contentLength > BigInt(Number.MAX_SAFE_INTEGER)) {
            errors.push(PACKET_LENGTH_INVALID_MESSAGE);
            return { packets, errors, pending: Buffer.alloc(0) };
        }
        const bodyLength = Number(contentLength);
        const packetLength = PACKET_LENGTH_HEADER_BYTES + bodyLength;
        if (buffer.byteLength < packetLength) {
            break;
        }
        const body = buffer.subarray(PACKET_LENGTH_HEADER_BYTES, packetLength);
        packets.push(body.toString(PACKET_TEXT_ENCODING));
        buffer = Buffer.from(buffer.subarray(packetLength));
    }

    return { packets, errors, pending: buffer };
}

/**
 * Converts a browser WebSocket message into one length-prefixed IPC packet.
 * @param message - Raw WebSocket message payload.
 * @returns An 8-byte unsigned big-endian length header followed by UTF-8 JSON bytes.
 */
function encodeBrowserMessage(message: string | Buffer): Buffer {
    if (typeof message !== 'string') {
        throw Error(BROWSER_JSON_ONLY_MESSAGE);
    }
    const parsed = JSON.parse(message) as { action?: unknown };
    debugBridge('browser.in.json', {
        action: typeof parsed?.action === 'string' ? parsed.action : undefined,
        chars: message.length,
        bytes: Buffer.byteLength(message, PACKET_TEXT_ENCODING),
        preview: previewText(message),
    });
    return encodePacketText(message);
}

/**
 * Converts JSON text into one length-prefixed IPC packet.
 * @param content - JSON packet text.
 * @returns An 8-byte unsigned big-endian length header followed by UTF-8 JSON bytes.
 */
function encodePacketText(content: string): Buffer {
    const body = Buffer.from(content, PACKET_TEXT_ENCODING);
    const header = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
    header.writeBigUInt64BE(BigInt(body.byteLength), 0);
    return Buffer.concat([header, body]);
}

function sendBrowserError(browser: ServerWebSocket<BrowserSocketData>, message: string) {
    browser.send(JSON.stringify({ action: SocketEvent.Error, data: message } satisfies IPCMessage));
}

function messageFromError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function looksLikeTextProtocol(buffer: Buffer): boolean {
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

function debugBridge(event: string, detail?: unknown) {
    if (!IPC_DEBUG) return;
    if (detail === undefined) {
        console.debug(`[IPC/bridge] ${event}`);
        return;
    }
    console.debug(`[IPC/bridge] ${event}`, detail);
}

function describeBrowserMessage(message: string | Buffer) {
    if (typeof message === 'string') {
        return {
            type: 'string',
            chars: message.length,
            bytes: Buffer.byteLength(message, PACKET_TEXT_ENCODING),
            preview: previewText(message),
            charCodes: previewCharCodes(message),
        };
    }
    return {
        type: 'binary',
        bytes: message.byteLength,
        hex: previewHex(message),
        textPreview: previewText(message.toString(PACKET_TEXT_ENCODING)),
    };
}

function previewText(value: string, max = 160): string {
    const clean = value.replace(/\0/g, '\\0');
    return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function previewHex(value: Uint8Array, max = 16): string {
    return Buffer.from(value.subarray(0, max)).toString('hex');
}

function previewCharCodes(value: string, max = 32): number[] {
    return Array.from(value.slice(0, max), (char) => char.charCodeAt(0));
}

export const IpcClientBridge = {
    start: startIpcClientBridge,
    decodePacketTexts,
    encodeBrowserMessage,
    encodePacketText,
} as const;
