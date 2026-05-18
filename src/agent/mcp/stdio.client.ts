import type { FlyflorPaths } from "../../config/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../events/index.ts";
import type { McpServerDefinition } from "./index.ts";

export interface McpToolDefinition {
    name: string;
    description?: string;
    inputSchema?: unknown;
}

export interface McpResourceDefinition {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
}

export interface McpPromptDefinition {
    name: string;
    description?: string;
    arguments?: unknown;
}

export interface McpResourceReadResult {
    contents?: unknown[];
    raw: unknown;
}

export interface McpPromptGetResult {
    description?: string;
    messages?: unknown[];
    raw: unknown;
}

export interface McpCallResult {
    content?: unknown[];
    isError?: boolean;
    raw: unknown;
}

export interface McpClientOptions {
    events?: EventSink;
    outputLimitBytes?: number;
    requestId?: string;
    timeoutMs?: number;
}

interface JsonRpcMessage {
    id?: number | string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: {
        code?: number;
        message?: string;
        data?: unknown;
    };
}

interface PendingRequest {
    reject(error: Error): void;
    resolve(value: unknown): void;
    timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 512 * 1024;
const MCP_PROTOCOL_VERSION = "2024-11-05";

export async function listStdioMcpTools(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpToolDefinition[]> {
    return withStdioSession(paths, server, options, async (session) => {
        const result = await session.request("tools/list", {});
        return normalizeTools(result);
    });
}

export async function listStdioMcpResources(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpResourceDefinition[]> {
    return withStdioSession(paths, server, options, async (session) => {
        const result = await session.request("resources/list", {});
        return normalizeResources(result, "MCP stdio resources/list");
    });
}

export async function listStdioMcpPrompts(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpPromptDefinition[]> {
    return withStdioSession(paths, server, options, async (session) => {
        const result = await session.request("prompts/list", {});
        return normalizePrompts(result, "MCP stdio prompts/list");
    });
}

export async function readStdioMcpResource(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    uri: string,
    options: McpClientOptions = {},
): Promise<McpResourceReadResult> {
    return withStdioSession(paths, server, options, async (session) => {
        const raw = await session.request("resources/read", { uri });
        const result = isRecord(raw) ? raw : {};
        return {
            contents: Array.isArray(result.contents) ? result.contents : undefined,
            raw,
        };
    });
}

export async function getStdioMcpPrompt(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    name: string,
    args: Record<string, unknown> = {},
    options: McpClientOptions = {},
): Promise<McpPromptGetResult> {
    return withStdioSession(paths, server, options, async (session) => {
        const raw = await session.request("prompts/get", {
            name,
            arguments: args,
        });
        const result = isRecord(raw) ? raw : {};
        return {
            description: typeof result.description === "string" ? result.description : undefined,
            messages: Array.isArray(result.messages) ? result.messages : undefined,
            raw,
        };
    });
}

export async function callStdioMcpTool(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    toolName: string,
    input: Record<string, unknown>,
    options: McpClientOptions = {},
): Promise<McpCallResult> {
    return withStdioSession(paths, server, options, async (session) => {
        const raw = await session.request("tools/call", {
            name: toolName,
            arguments: input,
        });
        const result = isRecord(raw) ? raw : {};
        return {
            content: Array.isArray(result.content) ? result.content : undefined,
            isError: typeof result.isError === "boolean" ? result.isError : undefined,
            raw,
        };
    });
}

async function withStdioSession<T>(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions,
    fn: (session: McpStdioSession) => Promise<T>,
): Promise<T> {
    if (!server.enabled) {
        throw new Error(`MCP server is disabled: ${server.name}`);
    }
    if (server.url || !server.command) {
        throw new Error(`MCP server is not a stdio command: ${server.name}`);
    }

    const session = new McpStdioSession(paths, server, options);
    await session.start();
    try {
        await session.initialize();
        return await fn(session);
    } finally {
        await session.stop();
    }
}

class McpStdioSession {
    private child?: ReturnType<typeof Bun.spawn>;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private outputBytes = 0;
    private stdoutBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    private stderr = "";
    private stopped = false;

    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly server: McpServerDefinition,
        private readonly options: McpClientOptions,
    ) {}

    public async start(): Promise<void> {
        if (!this.server.command) {
            throw new Error(`MCP server command is missing: ${this.server.name}`);
        }
        const cmd = [this.server.command, ...(this.server.args ?? [])];
        this.options.events?.publish(
            event(
                RuntimeEventType.ProcessStart,
                {
                    role: "mcp",
                    name: this.server.name,
                    command: this.server.command,
                    args: this.server.args ?? [],
                    cwd: this.paths.projectDir,
                },
                this.options.requestId,
            ),
        );
        this.child = Bun.spawn({
            cmd,
            cwd: this.paths.projectDir,
            env: childEnv(this.server.env),
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        void this.readStdout();
        void this.readStderr();
        void this.child.exited.then((exitCode) => {
            this.options.events?.publish(
                event(
                    RuntimeEventType.ProcessExit,
                    {
                        role: "mcp",
                        name: this.server.name,
                        exitCode,
                    },
                    this.options.requestId,
                ),
            );
            if (!this.stopped) {
                this.rejectAll(new Error(`MCP server exited unexpectedly: ${this.server.name} (${exitCode})`));
            }
        });
    }

    public async initialize(): Promise<void> {
        await this.request("initialize", {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
                name: "flyflor",
                version: "0.1.0",
            },
        });
        this.notify("notifications/initialized", {});
    }

    public request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.nextId++;
        const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const output = new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP request timed out: ${method}`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
        });
        this.writeMessage({
            jsonrpc: "2.0",
            id,
            method,
            params,
        });
        return output;
    }

    public notify(method: string, params: Record<string, unknown>): void {
        this.writeMessage({
            jsonrpc: "2.0",
            method,
            params,
        });
    }

    public async stop(): Promise<void> {
        this.stopped = true;
        this.rejectAll(new Error("MCP session stopped."));
        this.child?.kill();
        await this.child?.exited;
    }

    private writeMessage(message: Record<string, unknown>): void {
        const child = this.child;
        const stdin = child?.stdin;
        if (!stdin || typeof stdin === "number") {
            throw new Error(`MCP server stdin is not writable: ${this.server.name}`);
        }
        const body = JSON.stringify(message);
        const bytes = new TextEncoder().encode(body);
        stdin.write(`Content-Length: ${bytes.byteLength}\r\n\r\n${body}`);
    }

    private async readStdout(): Promise<void> {
        const stdout = this.child?.stdout;
        if (!stdout || typeof stdout === "number") {
            this.rejectAll(new Error(`MCP server stdout is not readable: ${this.server.name}`));
            return;
        }
        const reader = stdout.getReader();
        while (true) {
            const read = await reader.read();
            if (read.done) {
                break;
            }
            this.outputBytes += read.value.byteLength;
            if (this.outputBytes > (this.options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES)) {
                this.options.events?.publish(
                    event(
                        RuntimeEventType.ProcessOutputTruncated,
                        {
                            role: "mcp",
                            name: this.server.name,
                            limitBytes: this.options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
                        },
                        this.options.requestId,
                    ),
                );
                this.rejectAll(new Error(`MCP server output exceeded limit: ${this.server.name}`));
                this.child?.kill();
                return;
            }
            this.stdoutBuffer = concatBytes(this.stdoutBuffer, read.value);
            this.drainMessages();
        }
    }

    private async readStderr(): Promise<void> {
        const stderr = this.child?.stderr;
        if (!stderr || typeof stderr === "number") {
            return;
        }
        const reader = stderr.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const read = await reader.read();
            if (read.done) {
                break;
            }
            this.stderr = truncateMiddle(`${this.stderr}${decoder.decode(read.value, { stream: true })}`, 8_000);
        }
    }

    private drainMessages(): void {
        while (true) {
            const headerEnd = findHeaderEnd(this.stdoutBuffer);
            if (!headerEnd) {
                return;
            }
            const header = new TextDecoder().decode(this.stdoutBuffer.slice(0, headerEnd.index));
            const length = contentLength(header);
            if (length === undefined) {
                this.rejectAll(new Error(`MCP server returned a message without Content-Length: ${this.server.name}`));
                this.child?.kill();
                return;
            }
            const messageEnd = headerEnd.end + length;
            if (this.stdoutBuffer.byteLength < messageEnd) {
                return;
            }
            const body = this.stdoutBuffer.slice(headerEnd.end, messageEnd);
            this.stdoutBuffer = this.stdoutBuffer.slice(messageEnd);
            this.handleMessage(body);
        }
    }

    private handleMessage(body: Uint8Array): void {
        let message: JsonRpcMessage;
        try {
            message = JSON.parse(new TextDecoder().decode(body)) as JsonRpcMessage;
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.rejectAll(new Error(`MCP server returned invalid JSON: ${text}`));
            this.child?.kill();
            return;
        }

        if (message.id === undefined) {
            return;
        }
        const id = typeof message.id === "number" ? message.id : Number.parseInt(message.id, 10);
        const pending = this.pending.get(id);
        if (!pending) {
            return;
        }
        this.pending.delete(id);
        clearTimeout(pending.timer);
        if (message.error) {
            pending.reject(new Error(`MCP error ${message.error.code ?? "unknown"}: ${message.error.message ?? ""}`));
            return;
        }
        pending.resolve(message.result);
    }

    private rejectAll(error: Error): void {
        const suffix = this.stderr.trim() ? `\nMCP stderr:\n${this.stderr.trim()}` : "";
        const wrapped = suffix ? new Error(`${error.message}${suffix}`) : error;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(wrapped);
        }
        this.pending.clear();
    }
}

function normalizeTools(result: unknown): McpToolDefinition[] {
    if (!isRecord(result) || !Array.isArray(result.tools)) {
        throw new Error("MCP stdio tools/list returned invalid tools payload.");
    }
    return result.tools.filter(isToolDefinition).map((tool) => ({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: tool.inputSchema,
    }));
}

export function normalizeResources(result: unknown, label = "MCP resources/list"): McpResourceDefinition[] {
    if (!isRecord(result) || !Array.isArray(result.resources)) {
        throw new Error(`${label} returned invalid resources payload.`);
    }
    return result.resources.filter(isResourceDefinition).map((resource) => ({
        description: typeof resource.description === "string" ? resource.description : undefined,
        mimeType: typeof resource.mimeType === "string" ? resource.mimeType : undefined,
        name: typeof resource.name === "string" ? resource.name : undefined,
        uri: resource.uri,
    }));
}

export function normalizePrompts(result: unknown, label = "MCP prompts/list"): McpPromptDefinition[] {
    if (!isRecord(result) || !Array.isArray(result.prompts)) {
        throw new Error(`${label} returned invalid prompts payload.`);
    }
    return result.prompts.filter(isPromptDefinition).map((prompt) => ({
        arguments: prompt.arguments,
        description: typeof prompt.description === "string" ? prompt.description : undefined,
        name: prompt.name,
    }));
}

function isToolDefinition(value: unknown): value is McpToolDefinition {
    return isRecord(value) && typeof value.name === "string";
}

function isResourceDefinition(value: unknown): value is McpResourceDefinition {
    return isRecord(value) && typeof value.uri === "string";
}

function isPromptDefinition(value: unknown): value is McpPromptDefinition {
    return isRecord(value) && typeof value.name === "string";
}

function childEnv(serverEnv: Record<string, string> | undefined): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT", "SystemRoot"]) {
        const value = process.env[key];
        if (typeof value === "string" && value.length > 0) {
            env[key] = value;
        }
    }
    return {
        ...env,
        ...(serverEnv ?? {}),
    };
}

function findHeaderEnd(buffer: Uint8Array<ArrayBufferLike>): { end: number; index: number } | undefined {
    for (let index = 0; index < buffer.byteLength - 3; index += 1) {
        if (buffer[index] === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10) {
            return { index, end: index + 4 };
        }
    }
    for (let index = 0; index < buffer.byteLength - 1; index += 1) {
        if (buffer[index] === 10 && buffer[index + 1] === 10) {
            return { index, end: index + 2 };
        }
    }
    return undefined;
}

function contentLength(header: string): number | undefined {
    for (const raw of header.split(/\r?\n/u)) {
        const index = raw.indexOf(":");
        if (index < 0) {
            continue;
        }
        const key = raw.slice(0, index).trim().toLowerCase();
        if (key !== "content-length") {
            continue;
        }
        const value = Number.parseInt(raw.slice(index + 1).trim(), 10);
        return Number.isInteger(value) && value >= 0 ? value : undefined;
    }
    return undefined;
}

function concatBytes(
    left: Uint8Array<ArrayBufferLike>,
    right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
    const next = new Uint8Array(left.byteLength + right.byteLength);
    next.set(left, 0);
    next.set(right, left.byteLength);
    return next;
}

function truncateMiddle(value: string, max: number): string {
    if (value.length <= max) {
        return value;
    }
    const half = Math.floor((max - 20) / 2);
    return `${value.slice(0, half)}\n...truncated...\n${value.slice(-half)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
