#!/usr/bin/env bun

import { access, mkdir } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type NativeTool = "screen.screenshot" | "computer.mouse" | "computer.keyboard" | "computer.window";

interface SidecarRequest {
    readonly config?: unknown;
    readonly input?: unknown;
    readonly projectDir?: unknown;
    readonly tool?: unknown;
}

interface NativeInvocation {
    readonly config: JsonObject;
    readonly input: JsonObject;
    readonly projectDir: string;
    readonly tool: NativeTool;
}

const NATIVE_TOOLS = new Set<NativeTool>(["screen.screenshot", "computer.mouse", "computer.keyboard", "computer.window"]);
const DEFAULT_TIMEOUT_MS = 8_000;

async function main(): Promise<void> {
    try {
        const raw = await new Response(Bun.stdin.stream()).text();
        const request = parseRequest(raw);
        const input = objectInput(request.input);
        const result = await new NativeComputerSidecar().invoke({
            config: objectInput(request.config),
            input,
            projectDir: readString(request.projectDir) ?? process.cwd(),
            tool: requiredTool(request.tool),
        });
        process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    } catch (err) {
        const failure = failureFromError(err);
        const line = `${JSON.stringify(failure)}\n`;
        process.stdout.write(line);
        process.stderr.write(line);
        process.exit(1);
    }
}

class NativeComputerSidecar {
    public async invoke(invocation: NativeInvocation): Promise<JsonObject> {
        const dryRun = invocation.input.dryRun === true || invocation.config.dryRun === true;
        if (dryRun || invocation.input.probe === true) {
            return this.probe(invocation);
        }
        switch (invocation.tool) {
            case "screen.screenshot":
                return this.screenScreenshot(invocation);
            case "computer.window":
                return this.windowInfo(invocation);
            case "computer.mouse":
                return this.delegateInput(invocation, "mouse");
            case "computer.keyboard":
                return this.delegateInput(invocation, "keyboard");
        }
    }

    private async probe(invocation: NativeInvocation): Promise<JsonObject> {
        const candidates = this.candidates(invocation);
        const available = await Promise.all(candidates.map(async (candidate) => ({
            id: candidate.id,
            available: await commandExists(candidate.command),
            command: candidate.command,
        })));
        return {
            platform: process.platform,
            tool: invocation.tool,
            dryRun: invocation.input.dryRun === true || invocation.config.dryRun === true,
            available,
        };
    }

    private async screenScreenshot(invocation: NativeInvocation): Promise<JsonObject> {
        const output = outputPath(invocation);
        await mkdir(dirname(output), { recursive: true });
        if (process.platform === "darwin") {
            await runRequired("screencapture", ["-x", output], "screen.screenshot screencapture");
            return { path: output, platform: process.platform };
        }
        if (process.platform === "win32") {
            await runRequired("powershell", [
                "-NoProfile",
                "-Command",
                powershellScreenshotScript(output),
            ], "screen.screenshot powershell");
            return { path: output, platform: process.platform };
        }
        const linux = await firstAvailable(["grim", "gnome-screenshot", "spectacle"]);
        if (!linux) {
            throw new NativeSidecarError("unavailable", "screen.screenshot requires grim, gnome-screenshot, or spectacle on Linux");
        }
        const args = linux === "grim"
            ? [output]
            : linux === "gnome-screenshot"
                ? ["-f", output]
                : ["-b", "-n", "-o", output];
        await runRequired(linux, args, `screen.screenshot ${linux}`);
        return { path: output, platform: process.platform, command: linux };
    }

    private async windowInfo(invocation: NativeInvocation): Promise<JsonObject> {
        if (process.platform === "darwin") {
            return {
                platform: process.platform,
                result: await runRequired("osascript", ["-e", "tell application \"System Events\" to get name of first process whose frontmost is true"], "computer.window osascript"),
            };
        }
        if (process.platform === "win32") {
            return {
                platform: process.platform,
                result: await runRequired("powershell", ["-NoProfile", "-Command", "(Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1 ProcessName,MainWindowTitle | ConvertTo-Json -Compress)"], "computer.window powershell"),
            };
        }
        const command = await firstAvailable(["xdotool", "wmctrl"]);
        if (!command) {
            throw new NativeSidecarError("unavailable", "computer.window requires xdotool or wmctrl on Linux");
        }
        const args = command === "xdotool" ? ["getactivewindow", "getwindowname"] : ["-lp"];
        return { platform: process.platform, command, result: await runRequired(command, args, `computer.window ${command}`) };
    }

    private async delegateInput(invocation: NativeInvocation, action: "mouse" | "keyboard"): Promise<JsonObject> {
        const command = readString(action === "mouse" ? invocation.config.mouseCommand : invocation.config.keyboardCommand);
        const args = stringArray(action === "mouse" ? invocation.config.mouseArgs : invocation.config.keyboardArgs);
        if (!command) {
            throw new NativeSidecarError("unavailable", `computer.${action} requires config.${action}Command sidecar delegate`);
        }
        const inputArgs = stringArray(invocation.input.args);
        return {
            command,
            result: await runRequired(command, [...args, ...inputArgs], `computer.${action} delegate`),
        };
    }

    private candidates(invocation: NativeInvocation): Array<{ id: string; command: string }> {
        if (invocation.tool === "screen.screenshot") {
            return process.platform === "darwin"
                ? [{ id: "macos.screencapture", command: "screencapture" }]
                : process.platform === "win32"
                    ? [{ id: "windows.powershell", command: "powershell" }]
                    : [
                        { id: "linux.grim", command: "grim" },
                        { id: "linux.gnome-screenshot", command: "gnome-screenshot" },
                        { id: "linux.spectacle", command: "spectacle" },
                    ];
        }
        if (invocation.tool === "computer.window") {
            return process.platform === "darwin"
                ? [{ id: "macos.osascript", command: "osascript" }]
                : process.platform === "win32"
                    ? [{ id: "windows.powershell", command: "powershell" }]
                    : [
                        { id: "linux.xdotool", command: "xdotool" },
                        { id: "linux.wmctrl", command: "wmctrl" },
                    ];
        }
        const command = readString(invocation.tool === "computer.mouse" ? invocation.config.mouseCommand : invocation.config.keyboardCommand);
        return command ? [{ id: `${invocation.tool}.delegate`, command }] : [];
    }
}

class NativeSidecarError extends Error {
    public constructor(
        public readonly code: "failed" | "unavailable" | "unsupported",
        message: string,
        public readonly details: JsonObject = {},
    ) {
        super(message);
    }
}

async function runRequired(command: string, args: readonly string[], label: string): Promise<JsonObject> {
    const resolved = await resolveCommand(command);
    if (!resolved) {
        throw new NativeSidecarError("unavailable", `${label} command is unavailable: ${command}`);
    }
    const proc = Bun.spawn({ cmd: [resolved, ...args], stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
        throw new NativeSidecarError("failed", `${label} command failed`, { command, exitCode, stderr });
    }
    return { stdout, stderr, exitCode };
}

async function firstAvailable(commands: readonly string[]): Promise<string | undefined> {
    for (const command of commands) {
        if (await commandExists(command)) {
            return command;
        }
    }
    return undefined;
}

async function commandExists(command: string): Promise<boolean> {
    return (await resolveCommand(command)) !== undefined;
}

async function resolveCommand(command: string): Promise<string | undefined> {
    if (isAbsolute(command) || command.startsWith(".")) {
        const path = isAbsolute(command) ? command : join(process.cwd(), command);
        return await pathExists(path) ? path : undefined;
    }
    for (const dir of pathEntries()) {
        const path = join(dir, command);
        if (await pathExists(path)) return path;
    }
    return undefined;
}

function outputPath(invocation: NativeInvocation): string {
    const raw = readString(invocation.input.path) ?? join("screenshots", `${Date.now()}.png`);
    const path = isAbsolute(raw) ? raw : join(invocation.projectDir, raw);
    const resolved = resolve(path);
    if (!resolved.startsWith(resolve(invocation.projectDir))) {
        throw new NativeSidecarError("failed", "screen.screenshot path must stay under projectDir");
    }
    return resolved;
}

function powershellScreenshotScript(output: string): string {
    const escaped = output.replace(/'/g, "''");
    return `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bitmap=New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height; $graphics=[System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size); $bitmap.Save('${escaped}',[System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose()`;
}

function parseRequest(raw: string): SidecarRequest {
    if (raw.trim().length === 0) {
        throw new NativeSidecarError("failed", "empty process-json request");
    }
    return JSON.parse(raw) as SidecarRequest;
}

function requiredTool(value: unknown): NativeTool {
    const tool = requiredString(value, "request.tool");
    if (!NATIVE_TOOLS.has(tool as NativeTool)) {
        throw new NativeSidecarError("unsupported", `unsupported native computer tool: ${tool}`);
    }
    return tool as NativeTool;
}

function objectInput(value: unknown): JsonObject {
    if (value === undefined) return {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new NativeSidecarError("failed", "request object field must be an object");
    }
    return value as JsonObject;
}

function stringArray(value: unknown): readonly string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new NativeSidecarError("failed", "args must be an array");
    }
    return value.map((entry, index) => requiredString(entry, `args.${index}`));
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new NativeSidecarError("failed", `${path} must be a non-empty string`);
    }
    return value;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function failureFromError(err: unknown): JsonObject {
    if (err instanceof NativeSidecarError) {
        return { ok: false, code: err.code, error: err.message, ...err.details };
    }
    return { ok: false, code: "failed", error: err instanceof Error ? err.message : String(err) };
}

function pathEntries(): string[] {
    return (process.env.PATH ?? "").split(delimiter).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

await main();
