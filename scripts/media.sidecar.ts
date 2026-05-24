#!/usr/bin/env bun

/**
 * Media process-json sidecar.
 *
 * The kernel only sees this script as an external process. Real media work is
 * delegated at runtime to either a configured local process-json command or a
 * generic HTTP JSON provider; no OCR/STT/TTS SDK, model asset, or native addon
 * is imported into the Bun core.
 */
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

type JsonObject = Record<string, unknown>;
type MediaTool = "vision.analyze" | "vision.ocr" | "audio.transcribe" | "audio.speak";

interface SidecarRequest {
    readonly config?: unknown;
    readonly tool?: unknown;
    readonly input?: unknown;
    readonly cwd?: unknown;
    readonly projectDir?: unknown;
    readonly configDir?: unknown;
}

interface LocalCommandConfig {
    readonly command?: unknown;
    readonly args?: unknown;
    readonly timeoutMs?: unknown;
    readonly maxOutputBytes?: unknown;
}

const MEDIA_TOOLS = new Set<MediaTool>([
    "vision.analyze",
    "vision.ocr",
    "audio.transcribe",
    "audio.speak",
]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export async function runMediaSidecar(): Promise<void> {
    try {
        const raw = await new Response(Bun.stdin.stream()).text();
        const request = parseRequest(raw);
        const tool = requiredTool(request.tool);
        const input = objectInput(request.input);
        validateInput(tool, input);

        const dispatcher = new MediaSidecarDispatcher();
        const result = await dispatcher.invoke({
            config: objectInput(request.config),
            configDir: readString(request.configDir),
            cwd: readString(request.cwd),
            input,
            projectDir: readString(request.projectDir),
            tool,
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

interface MediaInvocation {
    readonly config: JsonObject;
    readonly configDir?: string;
    readonly cwd?: string;
    readonly input: JsonObject;
    readonly projectDir?: string;
    readonly tool: MediaTool;
}

class MediaSidecarDispatcher {
    public async invoke(invocation: MediaInvocation): Promise<JsonObject> {
        const local = this.localCommand(invocation.tool, invocation.config);
        if (local) {
            return new LocalProcessJsonProvider(local).invoke(invocation);
        }
        const url = readString(invocation.config.providerUrl);
        if (url) {
            return new HttpJsonMediaProvider(url, this.providerHeaders(invocation.config)).invoke(invocation);
        }
        throw new MediaSidecarError(
            "unavailable",
            `media provider is unavailable for ${invocation.tool}: configure sidecar config.providerUrl or config.localCommands`,
        );
    }

    private localCommand(tool: MediaTool, sidecarConfig: JsonObject): NormalizedLocalCommand | undefined {
        const map = optionalObject(sidecarConfig.localCommands, "config.localCommands");
        if (!map) {
            return undefined;
        }
        const config = map[tool];
        if (config === undefined) {
            return undefined;
        }
        return this.normalizeLocalCommand(config, tool);
    }

    private normalizeLocalCommand(value: unknown, tool: MediaTool): NormalizedLocalCommand {
        const config = asObject(value, `local command for ${tool}`) as unknown as LocalCommandConfig;
        return {
            args: optionalStringArray(config.args, `local command ${tool}.args`) ?? [],
            command: requiredString(config.command, `local command ${tool}.command`),
            maxOutputBytes: optionalPositiveInt(config.maxOutputBytes, `local command ${tool}.maxOutputBytes`) ?? DEFAULT_MAX_OUTPUT_BYTES,
            timeoutMs: optionalPositiveInt(config.timeoutMs, `local command ${tool}.timeoutMs`) ?? DEFAULT_TIMEOUT_MS,
            tool,
        };
    }

    private providerHeaders(sidecarConfig: JsonObject): Record<string, string> {
        const object = optionalObject(sidecarConfig.providerHeaders, "config.providerHeaders");
        if (!object) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(object).map(([key, value]) => [key, requiredString(value, `provider header ${key}`)]),
        );
    }
}

interface NormalizedLocalCommand {
    readonly args: readonly string[];
    readonly command: string;
    readonly maxOutputBytes: number;
    readonly timeoutMs: number;
    readonly tool: MediaTool;
}

class LocalProcessJsonProvider {
    public constructor(private readonly config: NormalizedLocalCommand) {}

    public async invoke(invocation: MediaInvocation): Promise<JsonObject> {
        const resolved = await this.resolveCommand(this.config.command);
        if (!resolved) {
            throw new MediaSidecarError(
                "unavailable",
                `local media command is unavailable for ${this.config.tool}: ${this.config.command}`,
            );
        }
        const proc = Bun.spawn({
            cmd: [resolved, ...this.config.args],
            env: childEnv(),
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
        stdin.write(new TextEncoder().encode(`${JSON.stringify(invocation)}\n`));
        stdin.end();

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill("SIGKILL");
        }, this.config.timeoutMs);
        if (typeof (timer as { unref?: () => void }).unref === "function") {
            (timer as { unref: () => void }).unref();
        }

        const [exitCode, stdout, stderr] = await Promise.all([
            proc.exited,
            collectBounded(proc.stdout, this.config.maxOutputBytes),
            collectBounded(proc.stderr, this.config.maxOutputBytes),
        ]);
        clearTimeout(timer);

        if (timedOut) {
            throw new MediaSidecarError("failed", `local media command timed out for ${this.config.tool}`, {
                command: this.config.command,
                timedOut: true,
            });
        }
        if (exitCode !== 0) {
            throw new MediaSidecarError("failed", `local media command failed for ${this.config.tool}`, {
                command: this.config.command,
                exitCode,
                stderr: stderr.text,
                truncated: stdout.truncated || stderr.truncated,
            });
        }
        const response = parseFirstJsonObjectLine(stdout.text, `local media command ${this.config.tool}`);
        if (response.ok === false) {
            throw new MediaSidecarError("failed", `local media command returned failure for ${this.config.tool}`, {
                command: this.config.command,
                response,
                stderr: stderr.text,
                truncated: stdout.truncated || stderr.truncated,
            });
        }
        return {
            provider: "local",
            response,
            stderr: stderr.text,
            truncated: stdout.truncated || stderr.truncated,
        };
    }

    private async resolveCommand(command: string): Promise<string | undefined> {
        if (isAbsolute(command)) {
            return (await pathExists(command)) ? command : undefined;
        }
        if (command.startsWith(".")) {
            const candidate = join(process.cwd(), command);
            return (await pathExists(candidate)) ? candidate : undefined;
        }
        for (const dir of pathEntries()) {
            const candidate = join(dir, command);
            if (await pathExists(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
}

class HttpJsonMediaProvider {
    public constructor(
        private readonly url: string,
        private readonly headers: Record<string, string>,
    ) {}

    public async invoke(invocation: MediaInvocation): Promise<JsonObject> {
        let response: Response;
        try {
            response = await fetch(this.url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...this.headers,
                },
                body: JSON.stringify(invocation),
            });
        } catch (err) {
            throw new MediaSidecarError("failed", `media HTTP provider request failed: ${messageFrom(err)}`);
        }
        const text = await response.text();
        const body = parseJsonObjectText(text, "media HTTP provider response");
        if (!response.ok) {
            throw new MediaSidecarError("failed", `media HTTP provider returned ${response.status}`, {
                status: response.status,
                body,
            });
        }
        if (body.ok === false) {
            throw new MediaSidecarError("failed", "media HTTP provider returned failure", {
                body,
                status: response.status,
            });
        }
        return {
            provider: "http-json",
            response: body,
            status: response.status,
        };
    }
}

class MediaSidecarError extends Error {
    public constructor(
        public readonly code: "failed" | "unavailable" | "unsupported",
        message: string,
        public readonly details: JsonObject = {},
    ) {
        super(message);
    }
}

function parseRequest(raw: string): SidecarRequest {
    if (raw.trim().length === 0) {
        throw new MediaSidecarError("failed", "empty process-json request");
    }
    try {
        return JSON.parse(raw) as SidecarRequest;
    } catch (err) {
        throw new MediaSidecarError("failed", "process-json request must be valid JSON", { cause: messageFrom(err) });
    }
}

function requiredTool(value: unknown): MediaTool {
    const tool = requiredString(value, "request.tool");
    if (!MEDIA_TOOLS.has(tool as MediaTool)) {
        throw new MediaSidecarError("unsupported", `unsupported media tool: ${tool}`);
    }
    return tool as MediaTool;
}

function objectInput(value: unknown): JsonObject {
    if (value === undefined) {
        return {};
    }
    return asObject(value, "request.input");
}

function validateInput(tool: MediaTool, input: JsonObject): void {
    if (tool === "audio.speak") {
        requiredString(input.text, "input.text");
        return;
    }
    if (tool === "vision.analyze" || tool === "vision.ocr") {
        requireAnyString(input, ["imagePath", "imageBase64", "imageUrl"], "input image");
        return;
    }
    requireAnyString(input, ["audioPath", "audioBase64", "audioUrl"], "input audio");
}

function requireAnyString(input: JsonObject, keys: readonly string[], label: string): void {
    if (keys.some((key) => readString(input[key]) !== undefined)) {
        return;
    }
    throw new MediaSidecarError("failed", `${label} must provide one of ${keys.join(", ")}`);
}

function failureFromError(err: unknown): JsonObject {
    if (err instanceof MediaSidecarError) {
        return {
            ok: false,
            code: err.code,
            error: err.message,
            ...err.details,
        };
    }
    return {
        ok: false,
        code: "failed",
        error: messageFrom(err),
    };
}

function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function asObject(value: unknown, path: string): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new MediaSidecarError("failed", `${path} must be an object`);
    }
    return value as JsonObject;
}

function optionalObject(value: unknown, path: string): JsonObject | undefined {
    if (value === undefined) {
        return undefined;
    }
    return asObject(value, path);
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new MediaSidecarError("failed", `${path} must be a non-empty string`);
    }
    return value;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringArray(value: unknown, path: string): readonly string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new MediaSidecarError("failed", `${path} must be an array`);
    }
    return value.map((entry, index) => requiredString(entry, `${path}.${index}`));
}

function optionalPositiveInt(value: unknown, path: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new MediaSidecarError("failed", `${path} must be a positive integer`);
    }
    return value;
}

function parseFirstJsonObjectLine(text: string, path: string): JsonObject {
    const line = text.split("\n").find((entry) => entry.trim().length > 0);
    if (!line) {
        throw new MediaSidecarError("failed", `${path} produced no stdout response`);
    }
    return parseJsonObjectText(line, `${path} stdout`);
}

function parseJsonObjectText(text: string, path: string): JsonObject {
    if (text.trim().length === 0) {
        throw new MediaSidecarError("failed", `${path} produced no JSON response`);
    }
    try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new MediaSidecarError("failed", `${path} must be a JSON object`);
        }
        return parsed as JsonObject;
    } catch (err) {
        if (err instanceof MediaSidecarError) {
            throw err;
        }
        throw new MediaSidecarError("failed", `${path} produced non-json response`, { cause: messageFrom(err) });
    }
}

async function collectBounded(
    stream: ReadableStream<Uint8Array> | null,
    maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
    if (!stream) return { text: "", truncated: false };
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            if (total + value.byteLength > maxBytes) {
                const remaining = maxBytes - total;
                if (remaining > 0) {
                    chunks.push(value.subarray(0, remaining));
                    total = maxBytes;
                }
                truncated = true;
                await reader.cancel();
                break;
            }
            chunks.push(value);
            total += value.byteLength;
        }
    } finally {
        reader.releaseLock();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return { text: new TextDecoder().decode(merged), truncated };
}

function childEnv(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
}

function pathEntries(): string[] {
    return (process.env.PATH ?? "")
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

if (import.meta.main) {
    await runMediaSidecar();
}
