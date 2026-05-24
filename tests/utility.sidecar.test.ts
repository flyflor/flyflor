import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const SIDECAR = new URL("../scripts/utility.sidecar.ts", import.meta.url).pathname;

describe("utility process-json sidecar", () => {
    test("hashes files under projectDir", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-utility-"));
        await writeFile(join(root, "data.txt"), "hello");
        try {
            const response = await invokeSidecarBody({
                tool: "file.hash",
                input: { path: "data.txt" },
                projectDir: root,
            });

            expect(response.algorithm).toBe("sha256");
            expect(response.hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("converts JSON to text and writes under projectDir", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-utility-"));
        try {
            const response = await invokeSidecarBody({
                tool: "data.convert",
                input: { from: "json", to: "text", input: { ok: true }, outputPath: "out/data.txt" },
                projectDir: root,
            });

            expect(response.path).toBe(join(root, "out", "data.txt"));
            expect(await readFile(join(root, "out", "data.txt"), "utf8")).toContain('"ok": true');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("creates and extracts project archives", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-utility-"));
        await mkdir(join(root, "src"), { recursive: true });
        await writeFile(join(root, "src", "a.txt"), "a");
        try {
            await invokeSidecarBody({
                tool: "archive.create",
                input: { paths: ["src/a.txt"], output: "archive/test.tar.gz" },
                projectDir: root,
            });
            await invokeSidecarBody({
                tool: "archive.extract",
                input: { archive: "archive/test.tar.gz", outputDir: "extract" },
                projectDir: root,
            });
            expect(await readFile(join(root, "extract", "src", "a.txt"), "utf8")).toBe("a");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("fails LSP delegate explicitly when no delegate is configured", async () => {
        const response = await invokeSidecar({ tool: "lsp.symbols", input: {}, config: {} }, { expectExit: 1 });
        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("unavailable");
        expect(String(response.body.error)).toContain("lspCommand");
    });

    test("delegates background tasks to an explicit local command", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-utility-"));
        const command = join(root, "task.sh");
        await writeFile(command, "#!/usr/bin/env sh\ncat >/dev/null\nprintf '{\"task\":\"ok\"}\\n'\n");
        await chmod(command, 0o755);
        try {
            const response = await invokeSidecarBody({
                tool: "task.background",
                input: { task: "demo" },
                config: { taskCommand: command },
                projectDir: root,
            });
            expect((response.result as { response: { task: string } }).response).toEqual({ task: "ok" });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("fails delegate explicitly when local command returns non-json", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-utility-"));
        const command = join(root, "task.sh");
        await writeFile(command, "#!/usr/bin/env sh\ncat >/dev/null\nprintf 'task-ok\\n'\n");
        await chmod(command, 0o755);
        try {
            const response = await invokeSidecar({
                tool: "task.background",
                input: { task: "demo" },
                config: { taskCommand: command },
                projectDir: root,
            }, { expectExit: 1 });

            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe("failed");
            expect(String(response.body.error)).toContain("non-json stdout response");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("fails delegate explicitly when local command returns ok false", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-utility-"));
        const command = join(root, "task.sh");
        await writeFile(command, "#!/usr/bin/env sh\ncat >/dev/null\nprintf '{\"ok\":false,\"error\":\"delegate failed\"}\\n'\n");
        await chmod(command, 0o755);
        try {
            const response = await invokeSidecar({
                tool: "task.background",
                input: { task: "demo" },
                config: { taskCommand: command },
                projectDir: root,
            }, { expectExit: 1 });

            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe("failed");
            expect(String(response.body.error)).toContain("returned failure");
            expect(response.body.delegate).toEqual({ ok: false, error: "delegate failed" });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("fails archive creation explicitly when platform tar command is unavailable", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-utility-"));
        await writeFile(join(root, "data.txt"), "hello");
        try {
            const response = await invokeSidecar({
                tool: "archive.create",
                input: { paths: ["data.txt"], output: "archive/test.tar.gz" },
                projectDir: root,
            }, { env: { PATH: "" }, expectExit: 1 });

            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe("unavailable");
            expect(String(response.body.error)).toContain("unavailable on this platform");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("rejects paths outside projectDir", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-utility-"));
        try {
            const response = await invokeSidecar({
                tool: "file.hash",
                input: { path: "../escape.txt" },
                projectDir: root,
            }, { expectExit: 1 });
            expect(String(response.body.error)).toContain("projectDir");
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
    options: { env?: Record<string, string>; expectExit?: number } = {},
): Promise<SidecarInvocationResult> {
    const proc = Bun.spawn([process.execPath, SIDECAR], {
        env: { ...process.env, ...options.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    stdin.end();
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(exit).toBe(options.expectExit ?? 0);
    return { body: JSON.parse(stdout.split("\n")[0] ?? "{}") as Record<string, unknown>, stderr };
}
