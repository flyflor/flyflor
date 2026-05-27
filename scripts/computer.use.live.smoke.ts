#!/usr/bin/env bun

import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
        const checks = await this.runDelegateClosure();
        if (process.platform !== "darwin") {
            return this.skip("cua-backend-macos-only", checks);
        }
        const cua = await this.locator.find();
        if (!cua) {
            return this.skip("cua-command-not-found", checks);
        }

        try {
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
            return { ok: false, command: cua.source, checks, failure: failureSummary(err) };
        }
    }

    private async runDelegateClosure(): Promise<string[]> {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-use-live-delegate-"));
        const delegate = join(root, "delegate.ts");
        await writeFile(
            delegate,
            `const raw = await new Response(Bun.stdin.stream()).text();
const request = JSON.parse(raw);
const readOnly = ["capture", "wait", "list_apps"].includes(request.action);
console.log(JSON.stringify({
  receivedAction: request.action,
  inputAction: request.input?.action,
  input: request.input,
  readOnly,
}));
`,
        );
        await chmod(delegate, 0o755);
        try {
            const checks: string[] = [];
            const config = { delegateCommand: "bun", delegateArgs: [delegate], timeoutMs: 15_000 };

            const capture = await this.invoker.call({
                tool: "computer.use",
                config,
                input: { action: "screenshot" },
                projectDir: root,
            });
            this.expectDelegateOk(capture, "capture", "screenshot", true);
            checks.push("delegate-alias-screenshot-capture");

            const key = await this.invoker.call({
                tool: "computer.use",
                config,
                input: { action: "press_key", key: "return" },
                projectDir: root,
            });
            this.expectDelegateOk(key, "key", "press_key", false);
            checks.push("delegate-alias-press_key");

            const scroll = await this.invoker.call({
                tool: "computer.use",
                config,
                input: { action: "scroll", direction: "Down" },
                projectDir: root,
            });
            this.expectDelegateOk(scroll, "scroll", "scroll", false);
            checks.push("delegate-scroll-direction-casing");

            const setValue = await this.invoker.call({
                tool: "computer.use",
                config,
                input: { action: "setValue", value: "Blue" },
                projectDir: root,
            });
            this.expectDelegateOk(setValue, "set_value", "setValue", false);
            checks.push("delegate-alias-setValue");

            const doubleClick = await this.invoker.call({
                tool: "computer.use",
                config,
                input: { action: "doubleClick", element: 1, captureAfter: true },
                projectDir: root,
            });
            this.expectDelegateOk(doubleClick, "double_click", "doubleClick", false);
            this.expectDelegateCaptureAfter(doubleClick, "double_click");
            checks.push("delegate-alias-doubleClick-captureAfter");

            return checks;
        } finally {
            await rm(root, { recursive: true, force: true });
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

    private expectDelegateOk(value: JsonObject, action: string, inputAction: string, readOnly: boolean): void {
        if (value.ok !== true || value.action !== action || value.backend !== "delegate" || value.readOnly !== readOnly) {
            throw new Error(`${action} did not return an ok delegate response: ${JSON.stringify(value).slice(0, 1000)}`);
        }
        const response = ((value.result as JsonObject | undefined)?.response as JsonObject | undefined) ?? {};
        if (response.receivedAction !== action || response.inputAction !== inputAction || response.readOnly !== readOnly) {
            throw new Error(`${action} delegate payload was not canonical while preserving input action: ${JSON.stringify(value).slice(0, 1000)}`);
        }
    }

    private expectDelegateCaptureAfter(value: JsonObject, action: string): void {
        const capture = value.captureAfter as JsonObject | undefined;
        if (!capture || capture.action !== "capture" || capture.backend !== "delegate" || capture.readOnly !== true) {
            throw new Error(`${action} did not include a delegate captureAfter response`);
        }
        const response = ((capture.result as JsonObject | undefined)?.response as JsonObject | undefined) ?? {};
        if (response.receivedAction !== "capture" || response.inputAction !== "capture") {
            throw new Error(`${action} captureAfter did not dispatch canonical capture: ${JSON.stringify(capture).slice(0, 1000)}`);
        }
    }

    private skip(reason: string, checks: readonly string[]): SmokeResult {
        return REQUIRE_CUA ? { ok: false, skipped: true, reason, checks } : { ok: true, skipped: true, reason, checks };
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
