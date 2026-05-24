#!/usr/bin/env bun

type JsonObject = Record<string, unknown>;

interface SidecarRequest {
    readonly tool?: unknown;
    readonly input?: unknown;
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

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_TIMEOUT_MS = 5_000;

class BrowserCdpClient {
    public constructor(private readonly endpoint: string) {}

    public async open(url: string): Promise<CdpTarget> {
        const target = await this.fetchJson<CdpTarget>(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).catch(
            () => this.fetchJson<CdpTarget>(`/json/new?${encodeURIComponent(url)}`),
        );
        if (!target.webSocketDebuggerUrl) {
            throw new Error("CDP target did not include webSocketDebuggerUrl");
        }
        return target;
    }

    public async sendToPage(method: string, params: JsonObject): Promise<unknown> {
        const target = await this.pageTarget();
        if (!target.webSocketDebuggerUrl) {
            throw new Error("CDP page target did not include webSocketDebuggerUrl");
        }
        return new CdpSocket(target.webSocketDebuggerUrl).send(method, params);
    }

    public async evaluateFunction(source: string, args: unknown[]): Promise<unknown> {
        return this.sendToPage("Runtime.callFunctionOn", {
            functionDeclaration: source,
            arguments: args.map((value) => ({ value })),
            awaitPromise: true,
            returnByValue: true,
        });
    }

    private async pageTarget(): Promise<CdpTarget> {
        const targets = await this.fetchJson<CdpTarget[]>("/json/list");
        const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
        if (!target) {
            throw new Error("no debuggable browser page target found");
        }
        return target;
    }

    private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await fetch(new URL(path, normalizedBaseUrl(this.endpoint)), init);
        if (!response.ok) {
            throw new Error(`CDP HTTP ${response.status} for ${path}`);
        }
        return (await response.json()) as T;
    }
}

try {
    const raw = await new Response(Bun.stdin.stream()).text();
    const request = parseRequest(raw);
    const input = objectInput(request.input);
    const client = new BrowserCdpClient(
        readString(input.cdpUrl) ?? readString(input.endpointUrl) ?? Bun.env.FLYFLOR_BROWSER_CDP_URL ?? DEFAULT_CDP_URL,
    );
    const result = await dispatch(client, requiredString(request.tool, "request.tool"), input);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

async function dispatch(client: BrowserCdpClient, tool: string, input: JsonObject): Promise<JsonObject> {
    switch (tool) {
        case "browser.open": {
            const target = await client.open(requiredString(input.url, "input.url"));
            return { targetId: target.id, url: target.url };
        }
        case "browser.navigate": {
            const result = await client.sendToPage("Page.navigate", { url: requiredString(input.url, "input.url") });
            return { result };
        }
        case "browser.snapshot": {
            const result = await client.sendToPage("Accessibility.getFullAXTree", {});
            return { snapshot: result };
        }
        case "browser.screenshot": {
            const result = asObject(
                await client.sendToPage("Page.captureScreenshot", {
                    format: readString(input.format) ?? "png",
                    fromSurface: true,
                }),
                "Page.captureScreenshot result",
            );
            return { data: result.data, format: readString(input.format) ?? "png" };
        }
        case "browser.evaluate": {
            const result = await client.sendToPage("Runtime.evaluate", {
                expression: requiredString(input.script, "input.script"),
                awaitPromise: true,
                returnByValue: true,
            });
            return { result };
        }
        case "browser.click": {
            const selector = requiredString(input.target, "input.target");
            const result = await client.evaluateFunction(
                `(selector) => {
                    const element = document.querySelector(selector);
                    if (!element) throw new Error("target not found: " + selector);
                    element.click();
                    return true;
                }`,
                [selector],
            );
            return { result };
        }
        case "browser.type": {
            const selector = requiredString(input.target, "input.target");
            const text = requiredString(input.text, "input.text");
            const result = await client.evaluateFunction(
                `(selector, text) => {
                    const element = document.querySelector(selector);
                    if (!element) throw new Error("target not found: " + selector);
                    element.focus();
                    if ("value" in element) {
                        element.value = text;
                        element.dispatchEvent(new Event("input", { bubbles: true }));
                        element.dispatchEvent(new Event("change", { bubbles: true }));
                    } else {
                        element.textContent = text;
                    }
                    return true;
                }`,
                [selector, text],
            );
            return { result };
        }
        default:
            throw new Error(`unsupported browser CDP tool: ${tool}`);
    }
}

class CdpSocket {
    private nextId = 1;

    public constructor(private readonly url: string) {}

    public async send(method: string, params: JsonObject): Promise<unknown> {
        const id = this.nextId++;
        const ws = new WebSocket(this.url);
        await waitForOpen(ws);
        const response = waitForResponse(ws, id);
        ws.send(JSON.stringify({ id, method, params }));
        try {
            return await response;
        } finally {
            ws.close();
        }
    }
}

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = timeout(() => reject(new Error("CDP WebSocket open timed out")));
        ws.onopen = () => {
            clearTimeout(timer);
            resolve();
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error("CDP WebSocket failed to open"));
        };
    });
}

function waitForResponse(ws: WebSocket, id: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timer = timeout(() => reject(new Error("CDP command timed out")));
        ws.onmessage = (event) => {
            const response = JSON.parse(String(event.data)) as CdpResponse;
            if (response.id !== id) {
                return;
            }
            clearTimeout(timer);
            if (response.error) {
                reject(new Error(response.error.data ?? response.error.message ?? "CDP command failed"));
                return;
            }
            resolve(response.result ?? {});
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error("CDP WebSocket command failed"));
        };
    });
}

function parseRequest(raw: string): SidecarRequest {
    if (raw.trim().length === 0) {
        throw new Error("empty process-json request");
    }
    return JSON.parse(raw) as SidecarRequest;
}

function objectInput(value: unknown): JsonObject {
    if (value === undefined) {
        return {};
    }
    return asObject(value, "request.input");
}

function asObject(value: unknown, path: string): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as JsonObject;
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${path} must be a non-empty string`);
    }
    return value;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizedBaseUrl(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

function timeout(callback: () => void): Timer {
    const timer = setTimeout(callback, DEFAULT_TIMEOUT_MS);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
    }
    return timer;
}
