import { describe, expect, test } from "bun:test";

const SIDECAR = new URL("../scripts/browser.cdp.sidecar.ts", import.meta.url).pathname;

describe("Browser CDP process-json sidecar", () => {
    test("opens a URL through the CDP HTTP endpoint", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.open",
                input: { url: "https://example.test/", cdpUrl: server.url },
            });

            expect(response).toEqual({
                ok: true,
                targetId: "target-1",
                url: "https://example.test/",
            });
            expect(server.httpRequests).toContain("/json/new?https%3A%2F%2Fexample.test%2F");
        } finally {
            server.stop();
        }
    });

    test("sends browser.evaluate through a page WebSocket target", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.evaluate",
                input: { script: "1 + 1", cdpUrl: server.url },
            });

            expect(response).toEqual({
                ok: true,
                result: {
                    result: {
                        type: "number",
                        value: 2,
                    },
                },
            });
            expect(server.commands).toEqual([
                {
                    id: 1,
                    method: "Runtime.evaluate",
                    params: {
                        expression: "1 + 1",
                        awaitPromise: true,
                        returnByValue: true,
                    },
                },
            ]);
        } finally {
            server.stop();
        }
    });

    test("rejects non-browser tools without semantic fallback", async () => {
        const response = await invokeSidecar({
            tool: "web.fetch",
            input: { url: "https://example.test/" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(String(response.body.error)).toContain("unsupported browser CDP tool: web.fetch");
        expect(response.stderr).toContain("unsupported browser CDP tool: web.fetch");
    });

    test("reports an unavailable CDP endpoint as a failed process-json invocation", async () => {
        const response = await invokeSidecar({
            tool: "browser.evaluate",
            input: { script: "document.title", cdpUrl: "http://127.0.0.1:1" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(String(response.body.error).length).toBeGreaterThan(0);
        expect(response.stderr.length).toBeGreaterThan(0);
    });
});

interface SidecarInvocationResult {
    body: Record<string, unknown>;
    stderr: string;
}

interface SidecarInvocationOptions {
    expectExit?: number;
}

async function invokeSidecarBody(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await invokeSidecar(request);
    expect(response.stderr).toBe("");
    return response.body;
}

async function invokeSidecar(
    request: Record<string, unknown>,
    options: SidecarInvocationOptions = {},
): Promise<SidecarInvocationResult> {
    const proc = Bun.spawn(["bun", SIDECAR], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    stdin.end();

    const [exit, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    expect(exit).toBe(options.expectExit ?? 0);
    return {
        body: JSON.parse(stdout.split("\n")[0] ?? "{}") as Record<string, unknown>,
        stderr,
    };
}

class MockCdpServer {
    public readonly commands: unknown[] = [];
    public readonly httpRequests: string[] = [];
    private readonly server: Bun.Server<{ id: string }>;

    public constructor() {
        this.server = Bun.serve<{ id: string }>({
            port: 0,
            fetch: (request, server) => {
                const url = new URL(request.url);
                this.httpRequests.push(`${url.pathname}${url.search}`);
                if (url.pathname === "/devtools/page/1") {
                    const upgraded = server.upgrade(request, { data: { id: "target-1" } });
                    return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
                }
                if (url.pathname === "/json/list") {
                    return Response.json([
                        {
                            id: "target-1",
                            type: "page",
                            url: "about:blank",
                            webSocketDebuggerUrl: this.url.replace("http://", "ws://") + "devtools/page/1",
                        },
                    ]);
                }
                if (url.pathname === "/json/new") {
                    return Response.json({
                        id: "target-1",
                        type: "page",
                        url: decodeURIComponent(url.search.slice(1)),
                        webSocketDebuggerUrl: this.url.replace("http://", "ws://") + "devtools/page/1",
                    });
                }
                return new Response("not found", { status: 404 });
            },
            websocket: {
                message: (socket, raw) => {
                    const command = JSON.parse(String(raw)) as { id: number; method: string; params?: unknown };
                    this.commands.push(command);
                    socket.send(
                        JSON.stringify({
                            id: command.id,
                            result: {
                                result: {
                                    type: "number",
                                    value: 2,
                                },
                            },
                        }),
                    );
                },
            },
        });
    }

    public get url(): string {
        return this.server.url.toString();
    }

    public stop(): void {
        this.server.stop(true);
    }
}
