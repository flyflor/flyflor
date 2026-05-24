import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const SIDECAR = new URL("../scripts/media.sidecar.ts", import.meta.url).pathname;

describe("media process-json sidecar", () => {
    test("fails explicitly when provider config is absent", async () => {
        const response = await invokeSidecar({
            tool: "vision.ocr",
            input: { imagePath: "/tmp/image.png" },
            config: {},
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("unavailable");
        expect(String(response.body.error)).toContain("config.providerUrl");
        expect(response.stderr).toContain("config.providerUrl");
    });

    test("delegates media calls to an HTTP JSON provider", async () => {
        const server = new MockMediaServer();
        try {
            const response = await invokeSidecarBody({
                tool: "audio.transcribe",
                input: { audioUrl: "https://example.test/audio.wav" },
                config: {
                    providerUrl: server.url,
                    providerHeaders: { authorization: "Bearer test" },
                },
            });

            expect(response.provider).toBe("http-json");
            expect(response.status).toBe(200);
            expect(response.response).toEqual({ text: "transcribed" });
            expect(server.requests).toEqual([
                {
                    authorization: "Bearer test",
                    tool: "audio.transcribe",
                },
            ]);
        } finally {
            server.stop();
        }
    });

    test("delegates media calls to configured local process-json commands", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-media-sidecar-"));
        const command = join(root, "media-provider.sh");
        await writeFile(command, "#!/usr/bin/env sh\ncat >/dev/null\nprintf '{\"text\":\"spoken\"}\\n'\n");
        await chmod(command, 0o755);
        try {
            const response = await invokeSidecarBody({
                tool: "audio.speak",
                input: { text: "hello" },
                config: {
                    localCommands: {
                        "audio.speak": { command },
                    },
                },
            });

            expect(response.provider).toBe("local");
            expect(response.response).toEqual({ text: "spoken" });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("fails explicitly when local media delegate returns non-json", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-media-sidecar-"));
        const command = join(root, "media-provider.sh");
        await writeFile(command, "#!/usr/bin/env sh\ncat >/dev/null\nprintf 'not-json\\n'\n");
        await chmod(command, 0o755);
        try {
            const response = await invokeSidecar({
                tool: "audio.speak",
                input: { text: "hello" },
                config: { localCommands: { "audio.speak": { command } } },
            }, { expectExit: 1 });

            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe("failed");
            expect(String(response.body.error)).toContain("non-json response");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("fails explicitly when HTTP media provider returns failure payload", async () => {
        const server = new MockMediaServer("failure");
        try {
            const response = await invokeSidecar({
                tool: "vision.analyze",
                input: { imageUrl: "https://example.test/image.png" },
                config: { providerUrl: server.url },
            }, { expectExit: 1 });

            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe("failed");
            expect(String(response.body.error)).toContain("provider returned failure");
            expect(response.body.body).toEqual({ ok: false, error: "provider failed" });
        } finally {
            server.stop();
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

async function invokeSidecar(request: Record<string, unknown>, options: { expectExit?: number } = {}): Promise<SidecarInvocationResult> {
    const proc = Bun.spawn(["bun", SIDECAR], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    stdin.end();
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(exit).toBe(options.expectExit ?? 0);
    return { body: JSON.parse(stdout.split("\n")[0] ?? "{}") as Record<string, unknown>, stderr };
}

class MockMediaServer {
    public readonly requests: Array<{ authorization: string | null; tool: unknown }> = [];
    private readonly server: ReturnType<typeof Bun.serve>;

    public constructor(private readonly mode: "success" | "failure" = "success") {
        this.server = Bun.serve({
            port: 0,
            fetch: async (request) => {
                const body = await request.json() as { tool?: unknown };
                this.requests.push({
                    authorization: request.headers.get("authorization"),
                    tool: body.tool,
                });
                if (this.mode === "failure") {
                    return Response.json({ ok: false, error: "provider failed" });
                }
                return Response.json({ text: "transcribed" });
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
