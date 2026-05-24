import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const SIDECAR = new URL("../scripts/web.search.sidecar.ts", import.meta.url).pathname;

describe("web search process-json sidecar", () => {
    test("fails web.search when no provider is configured", async () => {
        const response = await invokeSidecar({ tool: "web.search", input: { query: "flyflor" }, config: {} }, { expectExit: 1 });
        expect(response.body.ok).toBe(false);
        expect(String(response.body.error)).toContain("no configured provider");
        expect(response.stderr).toContain("no configured provider");
    });

    test("aggregates generic providers, dedupes URLs and records warnings", async () => {
        const server = new MockSearchServer();
        try {
            const response = await invokeSidecarBody({
                tool: "web.search",
                input: { query: "flyflor", limit: 4 },
                config: {
                    providers: [
                        { id: "one", kind: "generic", endpoint: `${server.url}/one` },
                        { id: "bad", kind: "generic", endpoint: `${server.url}/bad` },
                        { id: "two", kind: "generic", endpoint: `${server.url}/two` },
                    ],
                },
            });

            expect(response.cacheHit).toBe(false);
            expect((response.results as unknown[]).map((entry) => (entry as { url: string }).url)).toEqual([
                "https://example.test/a",
                "https://example.test/b",
                "https://example.test/c",
            ]);
            expect(response.warnings).toEqual([expect.stringContaining("bad")]);
            expect(response.providerStats).toEqual([
                { id: "one", count: 2 },
                { id: "bad", count: 0 },
                { id: "two", count: 2 },
            ]);
        } finally {
            server.stop();
        }
    });

    test("fetches, extracts and downloads web content", async () => {
        const server = new MockSearchServer();
        const root = await mkdtemp(join(tmpdir(), "flyflor-web-sidecar-"));
        try {
            const fetched = await invokeSidecarBody({ tool: "web.fetch", input: { url: `${server.url}/page`, maxChars: 20 } });
            expect(fetched.status).toBe(200);
            expect(fetched.truncated).toBe(true);

            const extracted = await invokeSidecarBody({ tool: "web.extract", input: { url: `${server.url}/page` } });
            expect(extracted.title).toBe("Example Page");
            expect(String(extracted.text)).toContain("Readable content");

            const downloaded = await invokeSidecarBody({
                tool: "web.download",
                input: { url: `${server.url}/page`, path: "downloads/page.html" },
                projectDir: root,
            });
            expect(downloaded.path).toBe(join(root, "downloads", "page.html"));
            expect(await readFile(join(root, "downloads", "page.html"), "utf8")).toContain("Readable content");
        } finally {
            server.stop();
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

async function invokeSidecar(request: Record<string, unknown>, options: { expectExit?: number } = {}): Promise<SidecarInvocationResult> {
    const proc = Bun.spawn(["bun", SIDECAR], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    stdin.end();
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(exit).toBe(options.expectExit ?? 0);
    return { body: JSON.parse(stdout.split("\n")[0] ?? "{}") as Record<string, unknown>, stderr };
}

class MockSearchServer {
    private readonly server: ReturnType<typeof Bun.serve>;

    public constructor() {
        this.server = Bun.serve({
            port: 0,
            fetch: (request) => {
                const url = new URL(request.url);
                if (url.pathname === "/bad") return new Response("bad", { status: 500 });
                if (url.pathname === "/one") {
                    return Response.json([
                        { title: "A", url: "https://example.test/a", snippet: "a" },
                        { title: "B", url: "https://example.test/b", snippet: "b" },
                    ]);
                }
                if (url.pathname === "/two") {
                    return Response.json([
                        { title: "A duplicate", url: "https://example.test/a#fragment", snippet: "a2" },
                        { title: "C", url: "https://example.test/c", snippet: "c" },
                    ]);
                }
                if (url.pathname === "/page") {
                    return new Response("<html><title>Example Page</title><body><script>x()</script><main>Readable content for extraction.</main></body></html>", {
                        headers: { "content-type": "text/html" },
                    });
                }
                return new Response("missing", { status: 404 });
            },
        });
    }

    public get url(): string {
        return this.server.url.toString().replace(/\/$/, "");
    }

    public stop(): void {
        this.server.stop(true);
    }
}
