import { readFileSync } from 'fs';
import { join } from 'path';
import type { ServerWebSocket } from 'bun';
import { MAX_BODY_BYTES } from '../src/ipc/packet';
import { IPC_PROTOCOL, type IpcEnvelope } from '../src/ipc/types';

/**
 * EN: Browser test bridge configuration.
 * ZH: 浏览器测试桥配置。
 *
 * EN: `socketEndpoint` is the kernel IPC endpoint; `host`/`port` expose the local WebSocket test page.
 * ZH: `socketEndpoint` 是内核 IPC 端点；`host`/`port` 暴露本地 WebSocket 测试页面。
 */
export interface IpcClientBridgeConfig {
    socketEndpoint: string;
    host: string;
    port: number;
    pagePath: string;
}

export enum SocketEvent {
    Close = 'close',
    Error = 'error',
    Open = 'open',
    Attention = 'attention',
    Agent = 'agent',
    ResponseReset = 'responseReset',
    StreamEnd = 'streamEnd',
    Event = 'event',
    Ask = 'ask',
    Confirm = 'confirm',
}

/**
 * EN: One JSON packet exchanged with the kernel and mirrored to the browser test page.
 * ZH: 与内核交换并镜像到浏览器测试页的一条 JSON packet。
 */
type IPCMessage = IpcEnvelope<SocketEvent, unknown>;

/** EN: WebSocket connection state stored by Bun for each browser client. ZH: Bun 为每个浏览器客户端保存的 WebSocket 连接状态。 */
interface BrowserSocketData {
    ipc?: Awaited<ReturnType<typeof Bun.connect<undefined>>>;
}

/** Default local host used by the browser test bridge. */
export const DEFAULT_HOST = '127.0.0.1';

/** Default WebSocket/HTTP port expected by `web/client.html`. */
export const DEFAULT_PORT = 17878;

/** Public kernel socket endpoint used by the test bridge. */
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

/** Error text used when a decoded packet body is not valid JSON. */
export const PACKET_JSON_INVALID_MESSAGE = 'Invalid IPC packet: JSON body is malformed';

/** Enables local IPC bridge diagnostics unless explicitly disabled. */
const IPC_DEBUG = process.env.NODE_ENV !== 'test' && process.env.FLYFLOR_IPC_DEBUG !== '0';

/**
 * EN: Result of decoding one kernel byte chunk into browser text packets.
 * ZH: 将一个 kernel 字节块解码成浏览器文本 packet 的结果。
 */
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

/**
 * EN: Starts the local HTTP/WebSocket bridge for `web/client.html`.
 * ZH: 为 `web/client.html` 启动本地 HTTP/WebSocket bridge。
 */
function startIpcClientBridge(options: Partial<IpcClientBridgeConfig> = {}) {
    const config: IpcClientBridgeConfig = { ...DEFAULT_CONFIG, ...options };
    const page = () => readFileSync(config.pagePath, PACKET_TEXT_ENCODING);

    const server = Bun.serve<BrowserSocketData>({
        hostname: config.host,
        port: config.port,
        fetch(request, server) {
            if (server.upgrade(request, { data: {} })) {
                return;
            }
            return new Response(page(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
 * EN: Opens one kernel IPC socket for a browser WebSocket connection.
 * ZH: 为一个浏览器 WebSocket 连接打开 kernel IPC socket。
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
                sendBrowserPacket(browser, SocketEvent.Close, true);
                browser.close();
            },
        },
    });
}

/**
 * EN: Mirrors length-prefixed kernel IPC packets to the browser WebSocket.
 * ZH: 将带长度前缀的 kernel IPC packet 镜像到浏览器 WebSocket。
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
 * EN: Decodes length-prefixed kernel IPC bytes into JSON packet strings.
 * ZH: 将带长度前缀的 kernel IPC 字节解码成 JSON packet 字符串。
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
        if (bodyLength > MAX_BODY_BYTES) {
            errors.push(PACKET_LENGTH_INVALID_MESSAGE);
            return { packets, errors, pending: Buffer.alloc(0) };
        }
        const packetLength = PACKET_LENGTH_HEADER_BYTES + bodyLength;
        if (buffer.byteLength < packetLength) {
            break;
        }
        const body = buffer.subarray(PACKET_LENGTH_HEADER_BYTES, packetLength);
        const text = body.toString(PACKET_TEXT_ENCODING);
        try {
            JSON.parse(text);
            packets.push(text);
        } catch (error) {
            errors.push(`${PACKET_JSON_INVALID_MESSAGE}: ${messageFromError(error)}; bytes=${body.byteLength}; preview=${previewText(text)}`);
        }
        buffer = Buffer.from(buffer.subarray(packetLength));
    }

    return { packets, errors, pending: buffer };
}

/**
 * EN: Converts a browser WebSocket message into one length-prefixed IPC packet.
 * ZH: 将一条浏览器 WebSocket 消息转换成带长度前缀的 IPC packet。
 */
function encodeBrowserMessage(message: string | Buffer): Buffer {
    if (typeof message !== 'string') {
        throw Error(BROWSER_JSON_ONLY_MESSAGE);
    }
    const parsed = JSON.parse(message) as Partial<IpcEnvelope>;
    if (parsed.protocol !== IPC_PROTOCOL) throw Error(`Unsupported IPC protocol: ${String(parsed.protocol)}`);
    if (typeof parsed.messageId !== 'string' || parsed.messageId.trim().length === 0) throw Error('IPC messageId is required');
    if (parsed.action !== 'user' && parsed.action !== 'answer' && parsed.action !== 'cancel') {
        throw Error(`Unsupported IPC action: ${String(parsed.action)}`);
    }
    debugBridge('browser.in.json', {
        action: typeof parsed?.action === 'string' ? parsed.action : undefined,
        chars: message.length,
        bytes: Buffer.byteLength(message, PACKET_TEXT_ENCODING),
        preview: previewText(message),
    });
    return encodePacketText(message);
}

/**
 * EN: Converts JSON text into one length-prefixed IPC packet.
 * ZH: 将 JSON 文本转换成一条带长度前缀的 IPC packet。
 */
function encodePacketText(content: string): Buffer {
    const body = Buffer.from(content, PACKET_TEXT_ENCODING);
    const header = Buffer.alloc(PACKET_LENGTH_HEADER_BYTES);
    header.writeBigUInt64BE(BigInt(body.byteLength), 0);
    return Buffer.concat([header, body]);
}

/**
 * EN: Sends one bridge error packet to the browser client.
 * ZH: 向浏览器客户端发送一条 bridge error packet。
 */
function sendBrowserError(browser: ServerWebSocket<BrowserSocketData>, message: string) {
    sendBrowserPacket(browser, SocketEvent.Error, message);
}

/**
 * EN: Sends one bridge packet to the browser client.
 * ZH: 向浏览器客户端发送一条 bridge packet。
 */
function sendBrowserPacket(browser: ServerWebSocket<BrowserSocketData>, action: SocketEvent, data: unknown) {
    browser.send(JSON.stringify({
        protocol: IPC_PROTOCOL,
        messageId: crypto.randomUUID(),
        action,
        data,
    } satisfies IPCMessage));
}

/**
 * EN: Converts an unknown thrown value into a message string.
 * ZH: 将未知抛出值转换成 message 字符串。
 */
function messageFromError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * EN: Detects raw text where a length-prefixed IPC packet is expected.
 * ZH: 在期望长度前缀 IPC packet 的位置检测原始文本。
 */
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

/**
 * EN: Emits optional local diagnostics for the IPC bridge.
 * ZH: 为 IPC bridge 输出可选本地诊断信息。
 */
function debugBridge(event: string, detail?: unknown) {
    if (!IPC_DEBUG) return;
    if (detail === undefined) {
        console.debug(`[IPC/bridge] ${event}`);
        return;
    }
    console.debug(`[IPC/bridge] ${event}`, detail);
}

/**
 * EN: Builds a compact diagnostic description of a browser message.
 * ZH: 构造浏览器消息的紧凑诊断描述。
 */
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

/**
 * EN: Returns a bounded text preview for diagnostics.
 * ZH: 返回用于诊断的有界文本预览。
 */
function previewText(value: string, max = 160): string {
    const clean = value.replace(/\0/g, '\\0');
    return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

/**
 * EN: Returns a bounded hexadecimal byte preview for diagnostics.
 * ZH: 返回用于诊断的有界十六进制字节预览。
 */
function previewHex(value: Uint8Array, max = 16): string {
    return Buffer.from(value.subarray(0, max)).toString('hex');
}

/**
 * EN: Returns a bounded character-code preview for diagnostics.
 * ZH: 返回用于诊断的有界字符码预览。
 */
function previewCharCodes(value: string, max = 32): number[] {
    return Array.from(value.slice(0, max), (char) => char.charCodeAt(0));
}

export const IpcClientBridge = {
    start: startIpcClientBridge,
    decodePacketTexts,
    encodeBrowserMessage,
    encodePacketText,
} as const;
