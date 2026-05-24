import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const SIDECAR = new URL("../scripts/computer.native.sidecar.ts", import.meta.url).pathname;

describe("native computer process-json sidecar", () => {
    test("probes platform candidates without performing control actions", async () => {
        const response = await invokeSidecarBody({
            tool: "screen.screenshot",
            input: { dryRun: true },
            config: {},
        });

        expect(response.tool).toBe("screen.screenshot");
        expect(response.platform).toBe(process.platform);
        expect(Array.isArray(response.available)).toBe(true);
    });

    test("fails mouse control explicitly when no delegate command is configured", async () => {
        const response = await invokeSidecar({
            tool: "computer.mouse",
            input: { args: ["click", "10", "10"] },
            config: {},
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("unavailable");
        expect(String(response.body.error)).toContain("mouseCommand");
        expect(response.stderr).toContain("mouseCommand");
    });

    test("delegates keyboard control to an explicit local command", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-native-"));
        const command = join(root, "keyboard.sh");
        const log = join(root, "keyboard.log");
        await writeFile(command, `#!/usr/bin/env sh\nprintf '%s\\n' "$*" > "${log}"\n`);
        await chmod(command, 0o755);
        try {
            const response = await invokeSidecarBody({
                tool: "computer.keyboard",
                input: { args: ["type", "hello"] },
                config: { keyboardCommand: command, keyboardArgs: ["--safe"] },
            });

            expect(response.command).toBe(command);
            expect(response.result).toMatchObject({ exitCode: 0 });
            expect(await Bun.file(log).text()).toBe("--safe type hello\n");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("keeps screenshot output under projectDir", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-native-project-"));
        try {
            const response = await invokeSidecar({
                tool: "screen.screenshot",
                input: { path: "../escape.png" },
                config: {},
                projectDir: root,
            }, { expectExit: 1 });

            expect(response.body.ok).toBe(false);
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

async function invokeSidecar(request: Record<string, unknown>, options: { expectExit?: number } = {}): Promise<SidecarInvocationResult> {
    const proc = Bun.spawn(["bun", SIDECAR], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    stdin.end();
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(exit).toBe(options.expectExit ?? 0);
    return { body: JSON.parse(stdout.split("\n")[0] ?? "{}") as Record<string, unknown>, stderr };
}
