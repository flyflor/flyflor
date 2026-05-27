import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const SIDECAR = new URL("../scripts/browser.use.sidecar.ts", import.meta.url).pathname;

describe("high-level browser.use process-json sidecar", () => {
    test("reports delegate backend as unavailable when no command is configured", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "snapshot" },
            config: {},
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("unavailable");
        expect(String(response.body.error)).toContain("delegateCommand");
    });

    test("blocks unsafe navigation protocols before invoking a backend", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "navigate", url: "javascript:alert(1)" },
            config: { backend: "cdp", cdpUrl: "http://127.0.0.1:1" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("blocked");
        expect(String(response.body.error)).toContain("blocked protocol");
    });

    test("reports configured delegate command availability before spawning", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "snapshot" },
            config: { delegateCommand: "./missing-browser-use-delegate" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("unavailable");
        expect(String(response.body.error)).toContain("command is unavailable");
    });

    test("drives browser actions through the CDP backend", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "click", target: "#continue" },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({
                ok: true,
                action: "click",
                backend: "cdp",
                readOnly: false,
            });
            expect(server.commands).toEqual([
                {
                    id: 1,
                    method: "Runtime.evaluate",
                    params: expect.objectContaining({
                        expression: expect.stringContaining('const selector = "#continue"'),
                        awaitPromise: true,
                        returnByValue: true,
                    }),
                },
            ]);
        } finally {
            server.stop();
        }
    });

    test("runs browser actions then captureAfter through the CDP backend", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "type", target: "#search", text: "flyflor", captureAfter: true },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({
                ok: true,
                action: "type",
                backend: "cdp",
                readOnly: false,
                captureAfter: {
                    action: "snapshot",
                    backend: "cdp",
                    readOnly: true,
                },
            });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual([
                "Runtime.evaluate",
                "Accessibility.getFullAXTree",
            ]);
        } finally {
            server.stop();
        }
    });

    test("runs the requested action through a delegate", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-browser-use-"));
        const delegate = join(root, "delegate.ts");
        const log = join(root, "delegate.log");
        await writeFile(
            delegate,
            `import { appendFile } from "node:fs/promises";
const raw = await new Response(Bun.stdin.stream()).text();
await appendFile("${log}", raw);
const request = JSON.parse(raw);
console.log(JSON.stringify({ receivedAction: request.action, url: request.input.url }));
`,
        );
        await chmod(delegate, 0o755);
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "open", url: "https://example.test/" },
                config: { delegateCommand: "bun", delegateArgs: [delegate] },
            });

            expect(response).toMatchObject({
                action: "open",
                backend: "delegate",
                readOnly: false,
                result: {
                    response: { receivedAction: "open", url: "https://example.test/" },
                },
            });
            const call = JSON.parse((await readFile(log, "utf8")).trim()) as { action: string };
            expect(call.action).toBe("open");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

interface SidecarInvocationResult {
    body: Record<string, unknown>;
    stderr: string;
}

async function invokeSidecarBody(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await invokeSidecar(request);
    expect(response.stderr).toBe("");
    return response.body;
}

async function invokeSidecar(
    request: Record<string, unknown>,
    options: { expectExit?: number } = {},
): Promise<SidecarInvocationResult> {
    const proc = Bun.spawn(["bun", SIDECAR], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    stdin.end();
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(exit).toBe(options.expectExit ?? 0);
    return { body: JSON.parse(stdout.split("\n")[0] ?? "{}") as Record<string, unknown>, stderr };
}

class MockCdpServer {
    public readonly commands: unknown[] = [];
    private readonly server: Bun.Server<{ id: string }>;

    public constructor() {
        this.server = Bun.serve<{ id: string }>({
            port: 0,
            fetch: (request, server) => {
                const url = new URL(request.url);
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
                                result: command.method === "Accessibility.getFullAXTree"
                                    ? { nodes: [] }
                                    : {
                                        type: "object",
                                        value: { ok: true },
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
