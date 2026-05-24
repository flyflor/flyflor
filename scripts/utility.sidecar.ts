#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type UtilityTool =
    | "lsp.symbols"
    | "lsp.diagnostics"
    | "task.background"
    | "file.hash"
    | "archive.create"
    | "archive.extract"
    | "data.convert";

interface SidecarRequest {
    readonly config?: unknown;
    readonly input?: unknown;
    readonly projectDir?: unknown;
    readonly tool?: unknown;
}

interface UtilityInvocation {
    readonly config: JsonObject;
    readonly input: JsonObject;
    readonly projectDir: string;
    readonly tool: UtilityTool;
}

const UTILITY_TOOLS = new Set<UtilityTool>([
    "lsp.symbols",
    "lsp.diagnostics",
    "task.background",
    "file.hash",
    "archive.create",
    "archive.extract",
    "data.convert",
]);

async function main(): Promise<void> {
    try {
        const raw = await new Response(Bun.stdin.stream()).text();
        const request = parseRequest(raw);
        const result = await new UtilitySidecar().invoke({
            config: objectInput(request.config),
            input: objectInput(request.input),
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

class UtilitySidecar {
    public async invoke(invocation: UtilityInvocation): Promise<JsonObject> {
        switch (invocation.tool) {
            case "file.hash":
                return this.fileHash(invocation);
            case "data.convert":
                return this.dataConvert(invocation);
            case "archive.create":
                return this.archiveCreate(invocation);
            case "archive.extract":
                return this.archiveExtract(invocation);
            case "lsp.symbols":
            case "lsp.diagnostics":
                return this.lspDelegate(invocation);
            case "task.background":
                return this.taskBackground(invocation);
        }
    }

    private async fileHash(invocation: UtilityInvocation): Promise<JsonObject> {
        const path = projectPath(invocation.projectDir, requiredString(invocation.input.path, "input.path"));
        const algorithm = readString(invocation.input.algorithm) ?? "sha256";
        const bytes = await readFile(path);
        return {
            algorithm,
            bytes: bytes.byteLength,
            hash: createHash(algorithm).update(bytes).digest("hex"),
            path,
        };
    }

    private async dataConvert(invocation: UtilityInvocation): Promise<JsonObject> {
        const from = requiredString(invocation.input.from, "input.from");
        const to = requiredString(invocation.input.to, "input.to");
        const value = invocation.input.input;
        const converted = this.convertValue(from, to, value);
        const outputPath = readString(invocation.input.outputPath);
        if (outputPath) {
            const path = projectPath(invocation.projectDir, outputPath);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, typeof converted === "string" ? converted : JSON.stringify(converted, null, 2));
            return { from, to, path };
        }
        return { from, to, output: converted };
    }

    private async archiveCreate(invocation: UtilityInvocation): Promise<JsonObject> {
        const output = projectPath(invocation.projectDir, requiredString(invocation.input.output, "input.output"));
        const paths = stringArray(invocation.input.paths, "input.paths").map((entry) => projectPath(invocation.projectDir, entry));
        await mkdir(dirname(output), { recursive: true });
        const proc = Bun.spawn({
            cmd: ["tar", "-czf", output, "-C", invocation.projectDir, ...paths.map((entry) => relativeToProject(invocation.projectDir, entry))],
            stdout: "pipe",
            stderr: "pipe",
        });
        const result = await processResult(proc, "archive.create tar");
        return { output, entries: paths.length, result };
    }

    private async archiveExtract(invocation: UtilityInvocation): Promise<JsonObject> {
        const archive = projectPath(invocation.projectDir, requiredString(invocation.input.archive, "input.archive"));
        const outputDir = projectPath(invocation.projectDir, requiredString(invocation.input.outputDir, "input.outputDir"));
        await mkdir(outputDir, { recursive: true });
        const proc = Bun.spawn({ cmd: ["tar", "-xzf", archive, "-C", outputDir], stdout: "pipe", stderr: "pipe" });
        const result = await processResult(proc, "archive.extract tar");
        return { archive, outputDir, result };
    }

    private async lspDelegate(invocation: UtilityInvocation): Promise<JsonObject> {
        const command = readString(invocation.config.lspCommand);
        if (!command) {
            throw new UtilitySidecarError("unavailable", `${invocation.tool} requires config.lspCommand delegate`);
        }
        return {
            delegate: "lsp",
            result: await delegate(command, stringArray(invocation.config.lspArgs, "config.lspArgs"), invocation),
        };
    }

    private async taskBackground(invocation: UtilityInvocation): Promise<JsonObject> {
        const command = readString(invocation.config.taskCommand);
        if (!command) {
            throw new UtilitySidecarError("unavailable", "task.background requires config.taskCommand delegate");
        }
        return {
            delegate: "task",
            result: await delegate(command, stringArray(invocation.config.taskArgs, "config.taskArgs"), invocation),
        };
    }

    private convertValue(from: string, to: string, value: unknown): unknown {
        if (from === "json" && to === "text") {
            return typeof value === "string" ? value : JSON.stringify(value, null, 2);
        }
        if (from === "text" && to === "json") {
            return JSON.parse(requiredString(value, "input.input"));
        }
        if (from === "json" && to === "json") {
            return value;
        }
        throw new UtilitySidecarError("unsupported", `unsupported data.convert format: ${from} to ${to}`);
    }
}

class UtilitySidecarError extends Error {
    public constructor(
        public readonly code: "failed" | "unavailable" | "unsupported",
        message: string,
        public readonly details: JsonObject = {},
    ) {
        super(message);
    }
}

async function delegate(command: string, args: readonly string[], invocation: UtilityInvocation): Promise<JsonObject> {
    const proc = Bun.spawn({
        cmd: [command, ...args],
        cwd: invocation.projectDir,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(invocation)}\n`));
    stdin.end();
    return processResult(proc, `${invocation.tool} delegate`);
}

interface ProcessJsonChild {
    readonly exited: Promise<number>;
    readonly stderr: ReadableStream<Uint8Array> | null;
    readonly stdout: ReadableStream<Uint8Array> | null;
}

async function processResult(proc: ProcessJsonChild, label: string): Promise<JsonObject> {
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
        throw new UtilitySidecarError("failed", `${label} failed`, { exitCode, stderr });
    }
    return { exitCode, stdout, stderr };
}

function projectPath(projectDir: string, value: string): string {
    const path = isAbsolute(value) ? value : join(projectDir, value);
    const resolved = resolve(path);
    if (!resolved.startsWith(resolve(projectDir))) {
        throw new UtilitySidecarError("failed", "path must stay under projectDir");
    }
    return resolved;
}

function relativeToProject(projectDir: string, path: string): string {
    return path.slice(resolve(projectDir).length + 1);
}

function parseRequest(raw: string): SidecarRequest {
    if (raw.trim().length === 0) {
        throw new UtilitySidecarError("failed", "empty process-json request");
    }
    return JSON.parse(raw) as SidecarRequest;
}

function requiredTool(value: unknown): UtilityTool {
    const tool = requiredString(value, "request.tool");
    if (!UTILITY_TOOLS.has(tool as UtilityTool)) {
        throw new UtilitySidecarError("unsupported", `unsupported utility tool: ${tool}`);
    }
    return tool as UtilityTool;
}

function objectInput(value: unknown): JsonObject {
    if (value === undefined) return {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new UtilitySidecarError("failed", "request object field must be an object");
    }
    return value as JsonObject;
}

function stringArray(value: unknown, path: string): readonly string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new UtilitySidecarError("failed", `${path} must be an array`);
    }
    return value.map((entry, index) => requiredString(entry, `${path}.${index}`));
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new UtilitySidecarError("failed", `${path} must be a non-empty string`);
    }
    return value;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function failureFromError(err: unknown): JsonObject {
    if (err instanceof UtilitySidecarError) {
        return { ok: false, code: err.code, error: err.message, ...err.details };
    }
    return { ok: false, code: "failed", error: err instanceof Error ? err.message : String(err) };
}

await main();
