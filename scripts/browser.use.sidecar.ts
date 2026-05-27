#!/usr/bin/env bun

import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { BrowserUrlSafetyError, BrowserUrlSafetyPolicy } from "./browser.url.safety.ts";

type JsonObject = Record<string, unknown>;
type BrowserUseAction =
    | "open"
    | "navigate"
    | "snapshot"
    | "screenshot"
    | "click"
    | "type"
    | "evaluate"
    | "scroll"
    | "back"
    | "press"
    | "get_images"
    | "vision"
    | "console"
    | "wait";

interface SidecarRequest {
    readonly config?: unknown;
    readonly input?: unknown;
    readonly tool?: unknown;
}

interface BrowserUseInvocation {
    readonly action: BrowserUseAction;
    readonly config: JsonObject;
    readonly input: JsonObject;
}

interface CdpTarget {
    readonly id?: string;
    readonly type?: string;
    readonly url?: string;
    readonly webSocketDebuggerUrl?: string;
}

interface CdpResponse {
    readonly id?: number;
    readonly result?: unknown;
    readonly error?: { message?: string; data?: string };
}

const BROWSER_USE_TOOL = "browser.use";
const ACTIONS = new Set<BrowserUseAction>([
    "open",
    "navigate",
    "snapshot",
    "screenshot",
    "click",
    "type",
    "evaluate",
    "scroll",
    "back",
    "press",
    "get_images",
    "vision",
    "console",
    "wait",
]);
const READ_ACTIONS = new Set<BrowserUseAction>(["snapshot", "screenshot", "get_images", "vision", "wait"]);
const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const BROWSER_URL_SAFETY = new BrowserUrlSafetyPolicy();

export async function runBrowserUseSidecar(): Promise<void> {
    try {
        const raw = await new Response(Bun.stdin.stream()).text();
        const request = parseRequest(raw);
        const tool = requiredString(request.tool, "request.tool");
        if (tool !== BROWSER_USE_TOOL) {
            throw new BrowserUseError("unsupported", `unsupported browser-use tool: ${tool}`);
        }
        const input = objectInput(request.input);
        const action = readAction(input.action);
        await validateAction(action, input);
        const result = await new BrowserUseSidecar().invoke({
            action,
            config: objectInput(request.config),
            input,
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

class BrowserUseSidecar {
    public async invoke(invocation: BrowserUseInvocation): Promise<JsonObject> {
        const backend = this.backend(invocation.config);
        const result = await this.invokeBackend(backend, invocation);
        const response: JsonObject = {
            action: invocation.action,
            backend: backend.kind,
            readOnly: READ_ACTIONS.has(invocation.action),
            result,
        };
        if (!captureAfterRequested(invocation.input) || READ_ACTIONS.has(invocation.action)) {
            return response;
        }
        const captureAction = readString(invocation.input.captureMode ?? invocation.input.capture_mode) === "screenshot" ? "screenshot" : "snapshot";
        const captureInput = captureAfterInput(invocation.input, captureAction);
        const capture = await this.invokeBackend(backend, {
            ...invocation,
            action: captureAction,
            input: captureInput,
        });
        return {
            ...response,
            captureAfter: {
                action: captureAction,
                backend: backend.kind,
                readOnly: true,
                result: capture,
            },
        };
    }

    private backend(config: JsonObject):
        | { kind: "cdp"; endpoint: string; timeoutMs: number }
        | { kind: "delegate"; command: string; args: readonly string[]; timeoutMs: number; maxOutputBytes: number } {
        const backend = readString(config.backend) ?? "delegate";
        const timeoutMs = boundedPositiveInt(config.timeoutMs, "config.timeoutMs", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
        const maxOutputBytes = boundedPositiveInt(config.maxOutputBytes, "config.maxOutputBytes", DEFAULT_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
        if (backend === "cdp") {
            return {
                kind: "cdp",
                endpoint: readString(config.cdpUrl) ?? Bun.env.FLYFLOR_BROWSER_CDP_URL ?? DEFAULT_CDP_URL,
                timeoutMs,
            };
        }
        if (backend === "delegate") {
            const command = readString(config.delegateCommand);
            if (!command) {
                throw new BrowserUseError(
                    "unavailable",
                    "browser.use requires config.delegateCommand or config.backend='cdp'",
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
        throw new BrowserUseError("unsupported", `unsupported browser.use backend: ${backend}`);
    }

    private async invokeBackend(
        backend:
            | { kind: "cdp"; endpoint: string; timeoutMs: number }
            | { kind: "delegate"; command: string; args: readonly string[]; timeoutMs: number; maxOutputBytes: number },
        invocation: BrowserUseInvocation,
    ): Promise<JsonObject> {
        return backend.kind === "cdp"
            ? await this.invokeCdp(backend, invocation)
            : await this.invokeDelegate(backend, invocation);
    }

    private async invokeDelegate(
        backend: { command: string; args: readonly string[]; timeoutMs: number; maxOutputBytes: number },
        invocation: BrowserUseInvocation,
    ): Promise<JsonObject> {
        return runProcessJson(backend.command, backend.args, invocation, backend.timeoutMs, backend.maxOutputBytes);
    }

    private async invokeCdp(
        backend: { endpoint: string; timeoutMs: number },
        invocation: BrowserUseInvocation,
    ): Promise<JsonObject> {
        const client = new BrowserUseCdpClient(backend.endpoint, backend.timeoutMs);
        switch (invocation.action) {
            case "open": {
                const target = await client.open(await requiredUrl(invocation.input.url, "input.url"));
                return { targetId: target.id, url: target.url };
            }
            case "navigate":
                return { response: await client.sendToPage("Page.navigate", { url: await requiredUrl(invocation.input.url, "input.url") }) };
            case "snapshot":
                return invocation.input.full === true
                    ? { snapshot: await client.sendToPage("Accessibility.getFullAXTree", {}), full: true }
                    : {
                        snapshot: await client.sendToPage("Runtime.evaluate", {
                            expression: snapshotExpression(boundedInt(invocation.input.maxElements ?? invocation.input.max_elements, 1, 1000) ?? 200),
                            awaitPromise: true,
                            returnByValue: true,
                        }),
                        full: false,
                    };
            case "screenshot": {
                const result = asObject(
                    await client.sendToPage("Page.captureScreenshot", {
                        format: readString(invocation.input.format) ?? "png",
                        fromSurface: true,
                    }),
                    "Page.captureScreenshot result",
                );
                return { data: result.data, format: readString(invocation.input.format) ?? "png" };
            }
            case "click":
                return {
                    response: await client.evaluateDomAction(
                        `(() => {
                            const selector = ${JSON.stringify(requiredTarget(invocation.input))};
                            const element = document.querySelector(selector);
                            if (!element) return { ok: false, error: "target not found: " + selector };
                            element.click();
                            return { ok: true };
                        })()`,
                    ),
                };
            case "type":
                return {
                    response: await client.evaluateDomAction(
                        `(() => {
                            const selector = ${JSON.stringify(requiredTarget(invocation.input))};
                            const text = ${JSON.stringify(requiredString(invocation.input.text, "input.text"))};
                            const element = document.querySelector(selector);
                            if (!element) return { ok: false, error: "target not found: " + selector };
                            element.focus();
                            if ("value" in element) {
                                element.value = text;
                                element.dispatchEvent(new Event("input", { bubbles: true }));
                                element.dispatchEvent(new Event("change", { bubbles: true }));
                            } else {
                                element.textContent = text;
                            }
                            return { ok: true };
                        })()`,
                    ),
                };
            case "evaluate":
                return {
                    response: await client.sendToPage("Runtime.evaluate", {
                        expression: requiredString(invocation.input.script ?? invocation.input.expression, "input.script"),
                        awaitPromise: true,
                        returnByValue: true,
                    }),
                };
            case "scroll":
                return {
                    response: await client.sendToPage("Runtime.evaluate", {
                        expression: scrollExpression(
                            readScrollDirection(invocation.input.direction) ?? "down",
                            boundedInt(invocation.input.amount, 1, 1000) ?? 3,
                        ),
                        awaitPromise: true,
                        returnByValue: true,
                    }),
                };
            case "back":
                return { response: await client.goBack() };
            case "press": {
                const key = normalizeBrowserPressKey(requiredString(invocation.input.key ?? invocation.input.keys, "input.key"));
                return {
                    response: [
                        await client.sendToPage("Input.dispatchKeyEvent", keyEvent("keyDown", key)),
                        await client.sendToPage("Input.dispatchKeyEvent", keyEvent("keyUp", key)),
                    ],
                };
            }
            case "get_images":
                return {
                    response: await client.sendToPage("Runtime.evaluate", {
                        expression: getImagesExpression(boundedInt(invocation.input.maxImages ?? invocation.input.max_images, 1, 1000) ?? 200),
                        awaitPromise: true,
                        returnByValue: true,
                    }),
                };
            case "vision": {
                if (!readString(invocation.config.visionDelegateCommand)) {
                    throw new BrowserUseError("unavailable", "browser.use vision requires config.visionDelegateCommand");
                }
                const format = readString(invocation.input.format) ?? "png";
                const screenshot = asObject(
                    await client.sendToPage("Page.captureScreenshot", {
                        format,
                        fromSurface: true,
                    }),
                    "Page.captureScreenshot result",
                );
                const data = requiredString(screenshot.data, "Page.captureScreenshot result.data");
                const vision = await invokeVisionDelegate(invocation, { data, format });
                return {
                    screenshot: {
                        format,
                        dataBytes: base64ByteLength(data),
                    },
                    vision,
                };
            }
            case "console":
                return {
                    response: await client.sendToPage("Runtime.evaluate", {
                        expression: consoleExpression(readString(invocation.input.expression), invocation.input.clear === true),
                        awaitPromise: true,
                        returnByValue: true,
                    }),
                };
            case "wait": {
                const ms = Math.min(Math.max(numberInput(invocation.input.ms) ?? secondsToMs(invocation.input.seconds) ?? 1000, 0), 30_000);
                await Bun.sleep(ms);
                return { waitedMs: ms };
            }
        }
    }
}

class BrowserUseCdpClient {
    public constructor(
        private readonly endpoint: string,
        private readonly timeoutMs: number,
    ) {}

    public async open(url: string): Promise<CdpTarget> {
        const target = await this.fetchJson<CdpTarget>(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).catch(
            () => this.fetchJson<CdpTarget>(`/json/new?${encodeURIComponent(url)}`),
        );
        if (!target.webSocketDebuggerUrl) {
            throw new BrowserUseError("failed", "CDP target did not include webSocketDebuggerUrl");
        }
        return target;
    }

    public async sendToPage(method: string, params: JsonObject): Promise<unknown> {
        const target = await this.pageTarget();
        if (!target.webSocketDebuggerUrl) {
            throw new BrowserUseError("failed", "CDP page target did not include webSocketDebuggerUrl");
        }
        return new CdpSocket(target.webSocketDebuggerUrl, this.timeoutMs).send(method, params);
    }

    public async goBack(): Promise<JsonObject> {
        const history = asObject(await this.sendToPage("Page.getNavigationHistory", {}), "Page.getNavigationHistory result");
        const currentIndex = numberInput(history.currentIndex);
        const entries = Array.isArray(history.entries) ? history.entries : [];
        if (currentIndex === undefined || currentIndex <= 0) {
            throw new BrowserUseError("failed", "browser.use back has no previous browser history entry");
        }
        const previous = asObject(entries[currentIndex - 1], "Page.getNavigationHistory previous entry");
        const entryId = numberInput(previous.id);
        if (entryId === undefined) {
            throw new BrowserUseError("failed", "browser.use back history entry did not include a numeric id");
        }
        return {
            currentIndex,
            entryId,
            response: await this.sendToPage("Page.navigateToHistoryEntry", { entryId }),
        };
    }

    public async evaluateDomAction(expression: string): Promise<unknown> {
        const response = asObject(await this.evaluateExpression(expression), "Runtime.evaluate result");
        if (response.exceptionDetails !== undefined) {
            throw new BrowserUseError("failed", "browser.use DOM action raised a runtime exception", {
                exceptionDetails: response.exceptionDetails,
            });
        }
        const result = asObject(response.result, "Runtime.evaluate result.result");
        const value = result.value;
        if (typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false) {
            throw new BrowserUseError("failed", String((value as { error?: unknown }).error ?? "browser.use DOM action failed"));
        }
        return response;
    }

    public async evaluateExpression(expression: string): Promise<unknown> {
        return this.sendToPage("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
    }

    private async pageTarget(): Promise<CdpTarget> {
        const targets = await this.fetchJson<CdpTarget[]>("/json/list");
        const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
        if (!target) {
            throw new BrowserUseError("unavailable", "no debuggable browser page target found");
        }
        return target;
    }

    private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
        const controller = new AbortController();
        const timer = timeout(() => controller.abort(), this.timeoutMs);
        let response: Response;
        try {
            response = await fetch(new URL(path, normalizedBaseUrl(this.endpoint)), {
                ...init,
                signal: controller.signal,
            });
        } catch (err) {
            if (controller.signal.aborted) {
                throw new BrowserUseError("failed", `CDP HTTP request timed out for ${path}`);
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            throw new BrowserUseError("failed", `CDP HTTP ${response.status} for ${path}`);
        }
        return (await response.json()) as T;
    }
}

class CdpSocket {
    private nextId = 1;

    public constructor(
        private readonly url: string,
        private readonly timeoutMs: number,
    ) {}

    public async send(method: string, params: JsonObject): Promise<unknown> {
        const id = this.nextId++;
        const ws = new WebSocket(this.url);
        await waitForOpen(ws, this.timeoutMs);
        const response = waitForResponse(ws, id, this.timeoutMs);
        ws.send(JSON.stringify({ id, method, params }));
        try {
            return await response;
        } finally {
            ws.close();
        }
    }
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
        throw new BrowserUseError("unavailable", `browser.use command is unavailable: ${command}`);
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
        throw new BrowserUseError("failed", "browser.use delegate timed out", { command, timedOut: true });
    }
    if (exitCode !== 0) {
        throw new BrowserUseError("failed", "browser.use delegate failed", {
            command,
            exitCode,
            stderr: stderr.text,
            truncated: stdout.truncated || stderr.truncated,
        });
    }
    return {
        exitCode,
        response: parseFirstJsonLine(stdout.text, "browser.use delegate"),
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
    };
}

async function invokeVisionDelegate(
    invocation: BrowserUseInvocation,
    screenshot: { readonly data: string; readonly format: string },
): Promise<JsonObject> {
    const command = readString(invocation.config.visionDelegateCommand);
    if (!command) {
        throw new BrowserUseError("unavailable", "browser.use vision requires config.visionDelegateCommand");
    }
    const timeoutMs = invocation.config.visionTimeoutMs === undefined
        ? boundedPositiveInt(invocation.config.timeoutMs, "config.timeoutMs", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
        : boundedPositiveInt(invocation.config.visionTimeoutMs, "config.visionTimeoutMs", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const maxOutputBytes = invocation.config.visionMaxOutputBytes === undefined
        ? boundedPositiveInt(invocation.config.maxOutputBytes, "config.maxOutputBytes", DEFAULT_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES)
        : boundedPositiveInt(invocation.config.visionMaxOutputBytes, "config.visionMaxOutputBytes", DEFAULT_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
    return runProcessJson(command, stringArray(invocation.config.visionDelegateArgs), {
        tool: BROWSER_USE_TOOL,
        action: "vision",
        input: invocation.input,
        config: invocation.config,
        question: requiredString(invocation.input.question, "input.question"),
        annotate: invocation.input.annotate === true,
        screenshot,
    }, timeoutMs, maxOutputBytes);
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

async function validateAction(action: BrowserUseAction, input: JsonObject): Promise<void> {
    if (input.captureAfter !== undefined && typeof input.captureAfter !== "boolean") {
        throw new BrowserUseError("failed", "input.captureAfter must be a boolean");
    }
    if (input.capture_after !== undefined && typeof input.capture_after !== "boolean") {
        throw new BrowserUseError("failed", "input.capture_after must be a boolean");
    }
    if (input.captureMode !== undefined && readString(input.captureMode) !== "snapshot" && readString(input.captureMode) !== "screenshot") {
        throw new BrowserUseError("failed", "input.captureMode must be 'snapshot' or 'screenshot'");
    }
    if (input.capture_mode !== undefined && readString(input.capture_mode) !== "snapshot" && readString(input.capture_mode) !== "screenshot") {
        throw new BrowserUseError("failed", "input.capture_mode must be 'snapshot' or 'screenshot'");
    }
    if (input.full !== undefined && typeof input.full !== "boolean") {
        throw new BrowserUseError("failed", "input.full must be a boolean");
    }
    if (input.maxElements !== undefined || input.max_elements !== undefined) {
        boundedInt(input.maxElements ?? input.max_elements, 1, 1000);
    }
    if (action === "open" || action === "navigate") {
        await requiredUrl(input.url, "input.url");
    }
    if (action === "click") {
        requiredTarget(input);
    }
    if (action === "type") {
        requiredTarget(input);
        requiredString(input.text, "input.text");
    }
    if (action === "evaluate") {
        requiredString(input.script ?? input.expression, "input.script");
    }
    if (action === "scroll") {
        if (input.direction !== undefined) {
            readScrollDirection(input.direction);
        }
        if (input.amount !== undefined) {
            boundedInt(input.amount, 1, 1000);
        }
    }
    if (action === "press") {
        requiredString(input.key ?? input.keys, "input.key");
    }
    if (action === "get_images" && (input.maxImages !== undefined || input.max_images !== undefined)) {
        boundedInt(input.maxImages ?? input.max_images, 1, 1000);
    }
    if (action === "snapshot") {
        // full/maxElements are validated above because mutating actions may
        // pass them to control the follow-up snapshot via captureAfter.
    }
    if (action === "vision") {
        requiredString(input.question, "input.question");
        if (input.annotate !== undefined && typeof input.annotate !== "boolean") {
            throw new BrowserUseError("failed", "input.annotate must be a boolean");
        }
    }
    if (action === "console") {
        if (input.clear !== undefined && typeof input.clear !== "boolean") {
            throw new BrowserUseError("failed", "input.clear must be a boolean");
        }
        if (input.expression !== undefined) {
            requiredString(input.expression, "input.expression");
        }
    }
}

function captureAfterRequested(input: JsonObject): boolean {
    return input.captureAfter === true || input.capture_after === true;
}

function captureAfterInput(input: JsonObject, action: BrowserUseAction): JsonObject {
    if (action === "screenshot") {
        return Object.fromEntries(
            Object.entries({
                action: "screenshot",
                format: readString(input.format),
            }).filter(([, value]) => value !== undefined),
        );
    }
    return Object.fromEntries(
        Object.entries({
            action: "snapshot",
            full: typeof input.full === "boolean" ? input.full : undefined,
            maxElements: boundedInt(input.maxElements ?? input.max_elements, 1, 1000),
        }).filter(([, value]) => value !== undefined),
    );
}

function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = timeout(() => reject(new BrowserUseError("unavailable", "CDP WebSocket open timed out")), timeoutMs);
        ws.onopen = () => {
            clearTimeout(timer);
            resolve();
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new BrowserUseError("unavailable", "CDP WebSocket failed to open"));
        };
    });
}

function waitForResponse(ws: WebSocket, id: number, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timer = timeout(() => reject(new BrowserUseError("failed", "CDP command timed out")), timeoutMs);
        ws.onmessage = (event) => {
            const raw = String(event.data);
            let response: CdpResponse;
            try {
                response = JSON.parse(raw) as CdpResponse;
            } catch {
                clearTimeout(timer);
                reject(new BrowserUseError("failed", "CDP WebSocket returned non-json response", {
                    frame: raw.slice(0, 500),
                }));
                return;
            }
            if (response.id !== id) {
                return;
            }
            clearTimeout(timer);
            if (response.error) {
                reject(new BrowserUseError("failed", response.error.data ?? response.error.message ?? "CDP command failed"));
                return;
            }
            resolve(response.result ?? {});
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new BrowserUseError("failed", "CDP WebSocket command failed"));
        };
    });
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

function parseFirstJsonLine(value: string, label: string): unknown {
    const line = value.split(/\r?\n/u).find((entry) => entry.trim().length > 0);
    if (!line) {
        return {};
    }
    try {
        return JSON.parse(line);
    } catch {
        throw new BrowserUseError("failed", `${label} returned non-json output`, { output: line.slice(0, 500) });
    }
}

function parseRequest(raw: string): SidecarRequest {
    if (raw.trim().length === 0) {
        throw new BrowserUseError("failed", "empty process-json request");
    }
    return JSON.parse(raw) as SidecarRequest;
}

function readAction(value: unknown): BrowserUseAction {
    const action = requiredString(value, "input.action") as BrowserUseAction;
    if (!ACTIONS.has(action)) {
        throw new BrowserUseError("unsupported", `unsupported browser.use action: ${action}`);
    }
    return action;
}

function objectInput(value: unknown): JsonObject {
    if (value === undefined) return {};
    return asObject(value, "request object field");
}

function asObject(value: unknown, path: string): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new BrowserUseError("failed", `${path} must be an object`);
    }
    return value as JsonObject;
}

function stringArray(value: unknown): readonly string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new BrowserUseError("failed", "array field must be string[]");
    }
    return value;
}

async function requiredUrl(value: unknown, path: string): Promise<string> {
    try {
        return await BROWSER_URL_SAFETY.requiredUrl(value, path);
    } catch (err) {
        if (err instanceof BrowserUrlSafetyError) {
            throw new BrowserUseError("blocked", err.message);
        }
        throw err;
    }
}

function secondsToMs(value: unknown): number | undefined {
    const seconds = numberInput(value);
    return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

function numberInput(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedInt(value: unknown, min: number, max: number): number | undefined {
    const number = numberInput(value);
    if (number === undefined) return undefined;
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new BrowserUseError("failed", `integer field must be between ${min} and ${max}`);
    }
    return number;
}

function readScrollDirection(value: unknown): "up" | "down" | "left" | "right" | undefined {
    if (value === undefined) return undefined;
    const direction = readString(value);
    if (direction === undefined) return undefined;
    if (direction === "up" || direction === "down" || direction === "left" || direction === "right") {
        return direction;
    }
    throw new BrowserUseError("failed", "browser.use direction must be up, down, left, or right");
}

function scrollExpression(direction: "up" | "down" | "left" | "right", amount: number): string {
    const pixels = amount * 120;
    const dx = direction === "left" ? -pixels : direction === "right" ? pixels : 0;
    const dy = direction === "up" ? -pixels : direction === "down" ? pixels : 0;
    return `(() => { window.scrollBy(${JSON.stringify({ left: dx, top: dy, behavior: "instant" })}); return { ok: true, left: window.scrollX, top: window.scrollY }; })()`;
}

function normalizeBrowserPressKey(value: string): string {
    const raw = value.trim();
    const compact = raw.toLowerCase().replace(/[\s_-]+/gu, "");
    const aliases: Record<string, string> = {
        arrowdown: "ArrowDown",
        arrowleft: "ArrowLeft",
        arrowright: "ArrowRight",
        arrowup: "ArrowUp",
        backspace: "Backspace",
        del: "Delete",
        delete: "Delete",
        down: "ArrowDown",
        end: "End",
        enter: "Enter",
        esc: "Escape",
        escape: "Escape",
        home: "Home",
        left: "ArrowLeft",
        pagedown: "PageDown",
        pageup: "PageUp",
        return: "Enter",
        right: "ArrowRight",
        space: " ",
        spacebar: " ",
        tab: "Tab",
        up: "ArrowUp",
    };
    const functionKey = /^f([1-9]|1\d|2[0-4])$/u.exec(compact);
    if (functionKey) {
        return `F${functionKey[1]}`;
    }
    return aliases[compact] ?? raw;
}

function keyEvent(type: "keyDown" | "keyUp", key: string): JsonObject {
    return {
        type,
        key,
        text: type === "keyDown" && key.length === 1 ? key : undefined,
    };
}

function getImagesExpression(maxImages: number): string {
    return `(() => {
        const images = Array.from(document.images)
            .map((img) => ({
                src: img.currentSrc || img.src || "",
                alt: img.alt || "",
                width: img.naturalWidth || img.width || 0,
                height: img.naturalHeight || img.height || 0,
            }))
            .filter((img) => img.src && !img.src.startsWith("data:"))
            .slice(0, ${maxImages});
        return { ok: true, count: images.length, images };
    })()`;
}

function snapshotExpression(maxElements: number): string {
    return `(() => {
        const textOf = (element) => (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").replace(/\\s+/g, " ").trim().slice(0, 160);
        const roleOf = (element) => element.getAttribute("role") || "";
        const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        const selector = [
            "a[href]",
            "button",
            "input",
            "select",
            "textarea",
            "[contenteditable=true]",
            "[role=button]",
            "[role=link]",
            "[role=textbox]",
            "[role=checkbox]",
            "[role=radio]",
            "[role=combobox]",
            "[role=switch]",
            "[role=menuitem]",
            "[role=tab]",
            "[tabindex]:not([tabindex='-1'])",
        ].join(",");
        document.querySelectorAll("[data-flyflor-ref]").forEach((element) => element.removeAttribute("data-flyflor-ref"));
        const elements = Array.from(document.querySelectorAll(selector))
            .filter(visible)
            .slice(0, ${maxElements})
            .map((element, index) => {
                const id = "e" + (index + 1);
                element.setAttribute("data-flyflor-ref", id);
                const rect = element.getBoundingClientRect();
                return {
                    ref: "@" + id,
                    tag: element.tagName.toLowerCase(),
                    role: roleOf(element),
                    text: textOf(element),
                    ariaLabel: element.getAttribute("aria-label") || "",
                    title: element.getAttribute("title") || "",
                    href: element instanceof HTMLAnchorElement ? element.href : "",
                    type: element instanceof HTMLInputElement ? element.type : "",
                    placeholder: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : "",
                    disabled: "disabled" in element ? Boolean(element.disabled) : false,
                    bounds: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                    },
                };
            });
        return {
            ok: true,
            title: document.title || "",
            url: location.href,
            count: elements.length,
            maxElements: ${maxElements},
            elements,
        };
    })()`;
}

function consoleExpression(expression: string | undefined, clear: boolean): string {
    const source = expression === undefined ? "undefined" : JSON.stringify(expression);
    return `(() => {
        const key = "__flyflorConsoleBuffer";
        const serialize = (value) => {
            if (value instanceof Error) {
                return { type: "error", name: value.name, message: value.message, stack: value.stack || "" };
            }
            if (value === undefined) return { type: "undefined" };
            const type = typeof value;
            if (value === null || type === "string" || type === "number" || type === "boolean") {
                return { type, value };
            }
            try {
                return { type, value: JSON.parse(JSON.stringify(value)) };
            } catch {
                return { type, value: String(value) };
            }
        };
        const format = (args) => args.map((arg) => {
            const serialized = serialize(arg);
            if ("value" in serialized && typeof serialized.value === "string") return serialized.value;
            if ("message" in serialized) return serialized.message;
            return JSON.stringify(serialized.value ?? serialized.type);
        }).join(" ");
        const target = window;
        if (!target[key]) {
            const messages = [];
            const original = {};
            for (const level of ["log", "info", "warn", "error", "debug"]) {
                original[level] = console[level]?.bind(console);
                console[level] = (...args) => {
                    messages.push({ level, text: format(args), args: args.map(serialize), timestamp: Date.now() });
                    original[level]?.(...args);
                };
            }
            window.addEventListener("error", (event) => {
                messages.push({ level: "error", text: event.message || "window.error", args: [serialize(event.error || event.message)], timestamp: Date.now() });
            });
            window.addEventListener("unhandledrejection", (event) => {
                messages.push({ level: "error", text: "Unhandled promise rejection", args: [serialize(event.reason)], timestamp: Date.now() });
            });
            target[key] = { messages, original };
        }
        const state = target[key];
        const expressionSource = ${source};
        let evaluation;
        if (expressionSource !== undefined) {
            try {
                evaluation = { ok: true, result: serialize((0, eval)(expressionSource)) };
            } catch (err) {
                evaluation = { ok: false, error: serialize(err) };
            }
        }
        const messages = state.messages.slice();
        if (${clear ? "true" : "false"}) state.messages.length = 0;
        return { ok: true, count: messages.length, messages, evaluation, cleared: ${clear ? "true" : "false"} };
    })()`;
}

function boundedPositiveInt(value: unknown, path: string, fallback: number, max: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
        throw new BrowserUseError("failed", `${path} must be an integer between 1 and ${max}`);
    }
    return value;
}

function base64ByteLength(value: string): number {
    const compact = value.replace(/\s/gu, "");
    const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredString(value: unknown, path: string): string {
    const string = readString(value);
    if (!string) {
        throw new BrowserUseError("failed", `${path} must be a non-empty string`);
    }
    return string;
}

function requiredTarget(input: JsonObject): string {
    const target = readString(input.target) ?? readString(input.selector) ?? readString(input.ref);
    if (!target) {
        throw new BrowserUseError("failed", "input.target, input.selector, or input.ref must be a non-empty string");
    }
    return refTargetSelector(target);
}

function refTargetSelector(value: string): string {
    const ref = /^@?(e\d+)$/u.exec(value.trim());
    if (!ref) return value;
    return `[data-flyflor-ref="${ref[1]}"]`;
}

function normalizedBaseUrl(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

function timeout(callback: () => void, timeoutMs: number): Timer {
    const timer = setTimeout(callback, timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
    }
    return timer;
}

class BrowserUseError extends Error {
    public constructor(
        public readonly code: "blocked" | "failed" | "unavailable" | "unsupported",
        message: string,
        public readonly details: JsonObject = {},
    ) {
        super(message);
    }
}

function failureFromError(err: unknown): JsonObject {
    if (err instanceof BrowserUseError) {
        return { ok: false, code: err.code, error: err.message, details: err.details };
    }
    return { ok: false, code: "failed", error: err instanceof Error ? err.message : String(err) };
}

if (import.meta.main) {
    await runBrowserUseSidecar();
}
