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

/**
 * One IPC frame exchanged with the Flyflor kernel and mirrored to the browser test page.
 */
interface IPCMessage {
    kind: 'user' | 'agent' | 'error';
    content: string;
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
            browser.data.ipc = await connectKernelSocket(browser, config.socketEndpoint);
        },
        message(browser, message) {
            const ipc = browser.data.ipc;
            if (ipc === undefined) {
                browser.send(JSON.stringify({ kind: 'error', content: 'IPC socket is not connected' } satisfies IPCMessage));
                return;
            }
            ipc.write(normalizeFrame(message));
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
    return Bun.connect({
        unix: endpoint,
        socket: {
            data(_socket, data) {
                forwardJsonLines(browser, data);
            },
            error(_socket, error) {
                browser.send(JSON.stringify({ kind: 'error', content: error.message } satisfies IPCMessage));
            },
            close() {
                browser.close();
            },
        },
    });
}

/**
 * Mirrors newline-delimited kernel IPC frames to the browser WebSocket.
 * @param browser - Browser-side WebSocket.
 * @param data - Raw bytes received from the kernel socket.
 */
function forwardJsonLines(browser: ServerWebSocket<BrowserSocketData>, data: Uint8Array): void {
    const text = Buffer.from(data).toString('utf8');
    for (const line of text.split('\n')) {
        const frame = line.trim();
        if (frame.length > 0) {
            browser.send(frame);
        }
    }
}

/**
 * Converts a browser WebSocket message into one JSONL IPC frame.
 * @param message - Raw WebSocket message payload.
 * @returns A newline-terminated IPC frame.
 */
function normalizeFrame(message: string | Buffer): string {
    const text = typeof message === 'string' ? message : message.toString('utf8');
    return text.endsWith('\n') ? text : text + '\n';
}
