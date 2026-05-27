#!/usr/bin/env bun

import { access } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join } from "node:path";

type JsonObject = Record<string, unknown>;

interface CuaCandidate {
    readonly command: string;
    readonly source: string;
}

interface SmokeResult {
    readonly ok: boolean;
    readonly skipped?: boolean;
    readonly reason?: string;
    readonly command?: string;
    readonly checks?: readonly string[];
    readonly failure?: unknown;
}

const SIDECAR = new URL("./computer.use.sidecar.ts", import.meta.url).pathname;
const REQUIRE_CUA = Bun.argv.includes("--require-cua");

class ComputerUseLiveSmoke {
    private readonly locator = new CuaLocator();
    private readonly invoker = new ComputerUseInvoker(SIDECAR);

    public async run(): Promise<SmokeResult> {
        if (process.platform !== "darwin") {
            return this.skip("cua-backend-macos-only");
        }
        const cua = await this.locator.find();
        if (!cua) {
            return this.skip("cua-command-not-found");
        }

        try {
            const checks: string[] = [];
            const config = { backend: "cua", cuaCommand: cua.command, timeoutMs: 15_000 };

            const capture = await this.invoker.call({
                tool: "computer.use",
                config,
                input: { action: "capture", mode: "ax", maxElements: 200 },
                projectDir: process.cwd(),
            });
            this.expectOk(capture, "capture", "get_window_state", true);
            checks.push("capture");

            const listApps = await this.invoker.call({
                tool: "computer.use",
                config,
                input: { action: "list_apps" },
                projectDir: process.cwd(),
            });
            this.expectOk(listApps, "list_apps", "list_apps", true);
            checks.push("list_apps");

            const wait = await this.invoker.call({
                tool: "computer.use",
                config,
                input: { action: "wait", seconds: 0.1 },
                projectDir: process.cwd(),
            });
            this.expectOk(wait, "wait", "wait", true);
            checks.push("wait");

            return { ok: true, command: cua.source, checks };
        } catch (err) {
            return { ok: false, command: cua.source, failure: failureSummary(err) };
        }
    }

    private expectOk(value: JsonObject, action: string, backendTool: string, readOnly: boolean): void {
        if (
            value.ok !== true ||
            value.action !== action ||
            value.backend !== "cua" ||
            value.backendTool !== backendTool ||
            value.readOnly !== readOnly
        ) {
            throw new Error(`${action} did not return an ok CUA response: ${JSON.stringify(value).slice(0, 1000)}`);
        }
        const result = value.result as JsonObject | undefined;
        if (!result || typeof result.exitCode !== "number" || result.response === undefined) {
            throw new Error(`${action} did not include a process-json delegate result`);
        }
    }

    private skip(reason: string): SmokeResult {
        return REQUIRE_CUA ? { ok: false, skipped: true, reason } : { ok: true, skipped: true, reason };
    }
}

class CuaLocator {
    public async find(): Promise<CuaCandidate | undefined> {
        for (const candidate of this.candidates()) {
            if (await commandExists(candidate.command)) {
                return candidate;
            }
        }
        return undefined;
    }

    private candidates(): readonly CuaCandidate[] {
        const env = Bun.env.FLYFLOR_CUA_COMMAND;
        const commands: CuaCandidate[] = [];
        if (env) commands.push({ command: env, source: `env:${basename(env)}` });
        commands.push(
            { command: "cua-driver", source: "path:cua-driver" },
            { command: "/opt/homebrew/bin/cua-driver", source: "homebrew:cua-driver" },
            { command: "/usr/local/bin/cua-driver", source: "usr-local:cua-driver" },
        );
        return commands;
    }
}

class ComputerUseInvoker {
    public constructor(private readonly sidecar: string) {}

    public async call(request: JsonObject): Promise<JsonObject> {
        const proc = Bun.spawn(["bun", this.sidecar], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
        stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
        stdin.end();
        const [exitCode, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const body = this.parse(stdout);
        if (exitCode !== 0) {
            throw new Error(`computer.use sidecar exited ${exitCode}: ${JSON.stringify(body)} ${stderr}`);
        }
        return body;
    }

    private parse(stdout: string): JsonObject {
        const line = stdout.split(/\r?\n/u).find((entry) => entry.trim().length > 0);
        if (!line) throw new Error("computer.use sidecar returned empty stdout");
        return JSON.parse(line) as JsonObject;
    }
}

async function commandExists(command: string): Promise<boolean> {
    if (isAbsolute(command) || command.startsWith(".")) {
        return pathExists(isAbsolute(command) ? command : join(process.cwd(), command));
    }
    for (const dir of (Bun.env.PATH ?? "").split(delimiter)) {
        if (dir.trim().length === 0) continue;
        if (await pathExists(join(dir, command))) return true;
    }
    return false;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function failureSummary(err: unknown): unknown {
    if (!(err instanceof Error)) return err;
    return {
        name: err.name,
        message: err.message,
        stack: err.stack?.split("\n").slice(0, 8).join("\n"),
    };
}

const result = await new ComputerUseLiveSmoke().run();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) {
    process.exit(1);
}
