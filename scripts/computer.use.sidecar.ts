#!/usr/bin/env bun

import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

type JsonObject = Record<string, unknown>;
type ComputerUseAction =
    | "capture"
    | "click"
    | "double_click"
    | "right_click"
    | "middle_click"
    | "drag"
    | "scroll"
    | "type"
    | "key"
    | "set_value"
    | "wait"
    | "list_apps"
    | "focus_app";

interface SidecarRequest {
    readonly config?: unknown;
    readonly input?: unknown;
    readonly projectDir?: unknown;
    readonly tool?: unknown;
}

interface ComputerUseInvocation {
    readonly action: ComputerUseAction;
    readonly config: JsonObject;
    readonly input: JsonObject;
    readonly projectDir: string;
}

const COMPUTER_USE_TOOL = "computer.use";
const ACTIONS = new Set<ComputerUseAction>([
    "capture",
    "click",
    "double_click",
    "right_click",
    "middle_click",
    "drag",
    "scroll",
    "type",
    "key",
    "set_value",
    "wait",
    "list_apps",
    "focus_app",
]);
const READ_ACTIONS = new Set<ComputerUseAction>(["capture", "wait", "list_apps"]);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;
const BLOCKED_KEY_COMBOS = [
    ["cmd", "shift", "backspace"],
    ["cmd", "option", "backspace"],
    ["cmd", "ctrl", "q"],
    ["cmd", "shift", "q"],
    ["cmd", "option", "shift", "q"],
];
const BLOCKED_TYPE_PATTERNS = [
    /curl\s+[^|]*\|\s*bash/iu,
    /curl\s+[^|]*\|\s*sh/iu,
    /wget\s+[^|]*\|\s*bash/iu,
    /\bsudo\s+rm\s+-[rf]/iu,
    /\brm\s+-rf\s+\/\s*$/iu,
    /:\s*\(\)\s*\{\s*:\|:\s*&\s*\}/iu,
];

export async function runComputerUseSidecar(): Promise<void> {
    try {
        const raw = await new Response(Bun.stdin.stream()).text();
        const request = parseRequest(raw);
        const tool = requiredString(request.tool, "request.tool");
        if (tool !== COMPUTER_USE_TOOL) {
            throw new ComputerUseError("unsupported", `unsupported computer-use tool: ${tool}`);
        }
        const input = objectInput(request.input);
        const action = readAction(input.action);
        validateAction(action, input);
        const result = await new ComputerUseSidecar().invoke({
            action,
            config: objectInput(request.config),
            input,
            projectDir: readString(request.projectDir) ?? process.cwd(),
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

class ComputerUseSidecar {
    public async invoke(invocation: ComputerUseInvocation): Promise<JsonObject> {
        const backend = this.backend(invocation.config);
        const result = backend.kind === "cua"
            ? await this.invokeCua(backend, invocation)
            : await this.invokeDelegate(backend, invocation);
        if (invocation.input.captureAfter !== true || invocation.action === "capture") {
            return result;
        }
        const captureInvocation = {
            ...invocation,
            action: "capture" as const,
            input: { action: "capture" },
        };
        const capture = backend.kind === "cua"
            ? await this.invokeCua(backend, captureInvocation)
            : await this.invokeDelegate(backend, captureInvocation);
        return { ...result, captureAfter: capture };
    }

    private backend(config: JsonObject): { kind: "cua"; command: string; args: readonly string[]; timeoutMs: number; maxOutputBytes: number } | { kind: "delegate"; command: string; args: readonly string[]; timeoutMs: number; maxOutputBytes: number } {
        const backend = readString(config.backend) ?? "delegate";
        const timeoutMs = positiveInt(config.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
        const maxOutputBytes = positiveInt(config.maxOutputBytes) ?? DEFAULT_MAX_OUTPUT_BYTES;
        if (backend === "cua") {
            return {
                kind: "cua",
                command: readString(config.cuaCommand) ?? "cua-driver",
                args: stringArray(config.cuaArgs),
                timeoutMs,
                maxOutputBytes,
            };
        }
        if (backend === "delegate") {
            const command = readString(config.delegateCommand);
            if (!command) {
                throw new ComputerUseError(
                    "unavailable",
                    "computer.use requires config.delegateCommand or config.backend='cua' with cua-driver",
                );
            }
            return {
                kind: "delegate",
                command,
                args: stringArray(config.delegateArgs),
                timeoutMs,
                maxOutputBytes,
            };
        }
        throw new ComputerUseError("unsupported", `unsupported computer.use backend: ${backend}`);
    }

    private async invokeDelegate(
        backend: { command: string; args: readonly string[]; timeoutMs: number; maxOutputBytes: number },
        invocation: ComputerUseInvocation,
    ): Promise<JsonObject> {
        return {
            action: invocation.action,
            backend: "delegate",
            readOnly: READ_ACTIONS.has(invocation.action),
            result: await runProcessJson(backend.command, backend.args, invocation, backend.timeoutMs, backend.maxOutputBytes),
        };
    }

    private async invokeCua(
        backend: { command: string; args: readonly string[]; timeoutMs: number; maxOutputBytes: number },
        invocation: ComputerUseInvocation,
    ): Promise<JsonObject> {
        if (process.platform !== "darwin") {
            throw new ComputerUseError("unavailable", "computer.use cua backend is only available on macOS");
        }
        const tool = cuaToolFor(invocation.action);
        const payload = cuaPayload(invocation);
        const result = await runProcessJson(
            backend.command,
            [...backend.args, "mcp-call", tool],
            { ...invocation, backendTool: tool, backendPayload: payload },
            backend.timeoutMs,
            backend.maxOutputBytes,
        );
        return {
            action: invocation.action,
            backend: "cua",
            backendTool: tool,
            readOnly: READ_ACTIONS.has(invocation.action),
            result,
        };
    }
}

function cuaToolFor(action: ComputerUseAction): string {
    switch (action) {
        case "capture":
            return "get_window_state";
        case "click":
            return "click";
        case "double_click":
            return "double_click";
        case "right_click":
            return "right_click";
        case "middle_click":
            return "middle_click";
        case "drag":
            return "drag";
        case "scroll":
            return "scroll";
        case "type":
            return "type_text";
        case "key":
            return "press_key";
        case "set_value":
            return "set_value";
        case "wait":
            return "wait";
        case "list_apps":
            return "list_apps";
        case "focus_app":
            return "list_windows";
    }
}

function cuaPayload(invocation: ComputerUseInvocation): JsonObject {
    const input = invocation.input;
    const coordinateTarget = coordinate(input.coordinate);
    const fromCoordinate = coordinate(input.fromCoordinate) ?? coordinate(input.from_coordinate);
    const toCoordinate = coordinate(input.toCoordinate) ?? coordinate(input.to_coordinate);
    const payload: JsonObject = {
        action: invocation.action,
        app: readString(input.app),
        button: readButton(input.button),
        capture_after: input.captureAfter === true,
        click_count: invocation.action === "double_click" ? 2 : 1,
        element: numberInput(input.element),
        element_index: numberInput(input.element),
        from_element: numberInput(input.fromElement) ?? numberInput(input.from_element),
        from_x: fromCoordinate?.[0],
        from_y: fromCoordinate?.[1],
        max_elements: boundedInt(input.maxElements ?? input.max_elements, 1, 1000),
        mode: readCaptureMode(input.mode),
        modifiers: stringArray(input.modifiers),
        raise_window: input.raiseWindow === true || input.raise_window === true,
        seconds: boundedNumber(input.seconds, 0, 30),
        text: readString(input.text),
        to_element: numberInput(input.toElement) ?? numberInput(input.to_element),
        to_x: toCoordinate?.[0],
        to_y: toCoordinate?.[1],
        keys: readString(input.keys),
        value: readString(input.value),
        direction: readString(input.direction),
        amount: numberInput(input.amount),
        x: coordinateTarget?.[0],
        y: coordinateTarget?.[1],
    };
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function runProcessJson(
    command: string,
    args: readonly string[],
    payload: unknown,
    timeoutMs: number,
    maxOutputBytes: number,
): Promise<JsonObject> {
    const resolved = await resolveCommand(command);
    if (!resolved) {
        throw new ComputerUseError("unavailable", `computer.use command is unavailable: ${command}`);
    }
    const proc = Bun.spawn({
        cmd: [resolved, ...args],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(payload)}\n`));
    stdin.end();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
    }, timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
    }
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        collectBounded(proc.stdout, maxOutputBytes),
        collectBounded(proc.stderr, maxOutputBytes),
    ]);
    clearTimeout(timer);
    if (timedOut) {
        throw new ComputerUseError("failed", "computer.use delegate timed out", { command, timedOut: true });
    }
    if (exitCode !== 0) {
        throw new ComputerUseError("failed", "computer.use delegate failed", {
            command,
            exitCode,
            stderr: stderr.text,
            truncated: stdout.truncated || stderr.truncated,
        });
    }
    return {
        exitCode,
        response: parseFirstJsonLine(stdout.text, "computer.use delegate"),
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
    };
}

function validateAction(action: ComputerUseAction, input: JsonObject): void {
    if (input.captureAfter !== undefined && typeof input.captureAfter !== "boolean") {
        throw new ComputerUseError("failed", "input.captureAfter must be a boolean");
    }
    if (input.raiseWindow !== undefined && typeof input.raiseWindow !== "boolean") {
        throw new ComputerUseError("failed", "input.raiseWindow must be a boolean");
    }
    if (input.raise_window !== undefined && typeof input.raise_window !== "boolean") {
        throw new ComputerUseError("failed", "input.raise_window must be a boolean");
    }
    if (input.mode !== undefined) {
        readCaptureMode(input.mode);
    }
    if (input.maxElements !== undefined || input.max_elements !== undefined) {
        boundedInt(input.maxElements ?? input.max_elements, 1, 1000);
    }
    if (input.button !== undefined) {
        readButton(input.button);
    }
    if (input.modifiers !== undefined) {
        readModifiers(input.modifiers);
    }
    if (input.seconds !== undefined) {
        boundedNumber(input.seconds, 0, 30);
    }
    if (requiresPoint(action) && !hasPointTarget(input)) {
        throw new ComputerUseError("failed", `computer.use ${action} requires input.element or input.coordinate`);
    }
    if (action === "type") {
        const text = requiredString(input.text, "input.text");
        const blocked = BLOCKED_TYPE_PATTERNS.find((pattern) => pattern.test(text));
        if (blocked) {
            throw new ComputerUseError("blocked", `computer.use type text matched blocked pattern: ${blocked.source}`);
        }
    }
    if (action === "key") {
        const combo = canonicalKeyCombo(requiredString(input.keys, "input.keys"));
        const blocked = BLOCKED_KEY_COMBOS.find((parts) => parts.every((part) => combo.has(part)));
        if (blocked) {
            throw new ComputerUseError("blocked", `computer.use blocked key combo: ${blocked.join("+")}`);
        }
    }
    if (action === "set_value") {
        requiredString(input.value, "input.value");
    }
    if (action === "scroll") {
        requiredString(input.direction, "input.direction");
    }
    if (action === "focus_app") {
        requiredString(input.app, "input.app");
    }
    if (action === "drag" && !hasDragTarget(input)) {
        throw new ComputerUseError("failed", "computer.use drag requires element targets or coordinate targets");
    }
}

function requiresPoint(action: ComputerUseAction): boolean {
    return action === "click" || action === "double_click" || action === "right_click" || action === "middle_click";
}

function hasPointTarget(input: JsonObject): boolean {
    return input.element !== undefined || coordinate(input.coordinate) !== undefined;
}

function hasDragTarget(input: JsonObject): boolean {
    return (
        ((input.fromElement !== undefined || input.from_element !== undefined) && (input.toElement !== undefined || input.to_element !== undefined)) ||
        ((coordinate(input.fromCoordinate) ?? coordinate(input.from_coordinate)) !== undefined && (coordinate(input.toCoordinate) ?? coordinate(input.to_coordinate)) !== undefined)
    );
}

function canonicalKeyCombo(value: string): Set<string> {
    const aliases: Record<string, string> = { alt: "option", command: "cmd", control: "ctrl", "⌘": "cmd", "⌥": "option" };
    return new Set(value.split(/\s*\+\s*/u).map((part) => aliases[part.trim().toLowerCase()] ?? part.trim().toLowerCase()).filter(Boolean));
}

function readAction(value: unknown): ComputerUseAction {
    const action = requiredString(value, "input.action") as ComputerUseAction;
    if (!ACTIONS.has(action)) {
        throw new ComputerUseError("unsupported", `unsupported computer.use action: ${action}`);
    }
    return action;
}

async function collectBounded(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
    const reader = stream?.getReader();
    if (!reader) return { text: "", truncated: false };
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    while (true) {
        const item = await reader.read();
        if (item.done) break;
        total += item.value.byteLength;
        if (total <= maxBytes) {
            chunks.push(item.value);
        } else {
            const remaining = Math.max(0, maxBytes - (total - item.value.byteLength));
            if (remaining > 0) chunks.push(item.value.slice(0, remaining));
            truncated = true;
        }
    }
    return { text: new TextDecoder().decode(concat(chunks)), truncated };
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

async function resolveCommand(command: string): Promise<string | undefined> {
    if (isAbsolute(command) || command.startsWith(".")) {
        const path = isAbsolute(command) ? command : join(process.cwd(), command);
        for (const candidate of pathWithExecutableExtensions(path)) {
            if (await pathExists(candidate)) return candidate;
        }
        return undefined;
    }
    for (const dir of pathEntries()) {
        const path = join(dir, command);
        for (const candidate of pathWithExecutableExtensions(path)) {
            if (await pathExists(candidate)) return candidate;
        }
    }
    return undefined;
}

function pathEntries(): string[] {
    return (process.env.PATH ?? "").split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function pathWithExecutableExtensions(path: string): readonly string[] {
    const extensions = executableExtensions();
    if (extensions.length === 0 || extensions.some((extension) => path.toLowerCase().endsWith(extension.toLowerCase()))) {
        return [path];
    }
    return [path, ...extensions.map((extension) => `${path}${extension}`)];
}

function executableExtensions(): readonly string[] {
    const raw = process.env.PATHEXT;
    if (!raw && process.platform !== "win32") {
        return [];
    }
    const entries = raw?.split(/[;:]/u) ?? [".COM", ".EXE", ".BAT", ".CMD"];
    const normalized = entries
        .map((entry) => entry.trim())
        .filter(Boolean)
        .flatMap((entry) => {
            const extension = entry.startsWith(".") ? entry : `.${entry}`;
            return [extension, extension.toLowerCase()];
        });
    return [...new Set(normalized)];
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function parseFirstJsonLine(value: string, label: string): unknown {
    const line = value.split(/\r?\n/u).find((entry) => entry.trim().length > 0);
    if (!line) {
        return {};
    }
    try {
        return JSON.parse(line);
    } catch {
        throw new ComputerUseError("failed", `${label} returned non-json output`, { output: line.slice(0, 500) });
    }
}

function parseRequest(raw: string): SidecarRequest {
    if (raw.trim().length === 0) {
        throw new ComputerUseError("failed", "empty process-json request");
    }
    return JSON.parse(raw) as SidecarRequest;
}

function objectInput(value: unknown): JsonObject {
    if (value === undefined) return {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ComputerUseError("failed", "request object field must be an object");
    }
    return value as JsonObject;
}

function stringArray(value: unknown): readonly string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new ComputerUseError("failed", "array field must be string[]");
    }
    return value;
}

function readModifiers(value: unknown): readonly string[] {
    const modifiers = stringArray(value);
    const allowed = new Set(["cmd", "shift", "option", "alt", "ctrl", "fn"]);
    const invalid = modifiers.find((entry) => !allowed.has(entry));
    if (invalid) {
        throw new ComputerUseError("failed", `computer.use modifier is unsupported: ${invalid}`);
    }
    return modifiers;
}

function readButton(value: unknown): "left" | "right" | "middle" | undefined {
    if (value === undefined) return undefined;
    const button = readString(value);
    if (button === "left" || button === "right" || button === "middle") {
        return button;
    }
    throw new ComputerUseError("failed", "computer.use button must be left, right, or middle");
}

function readCaptureMode(value: unknown): "som" | "vision" | "ax" | undefined {
    if (value === undefined) return undefined;
    const mode = readString(value);
    if (mode === "som" || mode === "vision" || mode === "ax") {
        return mode;
    }
    throw new ComputerUseError("failed", "computer.use mode must be som, vision, or ax");
}

function coordinate(value: unknown): [number, number] | undefined {
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const x = numberInput(value[0]);
    const y = numberInput(value[1]);
    return x === undefined || y === undefined ? undefined : [x, y];
}

function numberInput(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
    const number = numberInput(value);
    if (number === undefined) return undefined;
    if (number < min || number > max) {
        throw new ComputerUseError("failed", `number field must be between ${min} and ${max}`);
    }
    return number;
}

function boundedInt(value: unknown, min: number, max: number): number | undefined {
    const number = boundedNumber(value, min, max);
    if (number === undefined) return undefined;
    if (!Number.isInteger(number)) {
        throw new ComputerUseError("failed", "integer field must be an integer");
    }
    return number;
}

function positiveInt(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredString(value: unknown, path: string): string {
    const string = readString(value);
    if (!string) {
        throw new ComputerUseError("failed", `${path} must be a non-empty string`);
    }
    return string;
}

class ComputerUseError extends Error {
    public constructor(
        public readonly code: "blocked" | "failed" | "unavailable" | "unsupported",
        message: string,
        public readonly details: JsonObject = {},
    ) {
        super(message);
    }
}

function failureFromError(err: unknown): JsonObject {
    if (err instanceof ComputerUseError) {
        return { ok: false, code: err.code, error: err.message, details: err.details };
    }
    return { ok: false, code: "failed", error: err instanceof Error ? err.message : String(err) };
}

if (import.meta.main) {
    await runComputerUseSidecar();
}
