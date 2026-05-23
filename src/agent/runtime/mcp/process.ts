import type { FlyflorPaths } from "../../../config/index.ts";
import type { McpCallResult, McpServerDefinition, McpToolCallRequest, McpToolCatalogEntry } from "../../mcp/index.ts";
import type { ShellHookExecutor, ShellHookResult } from "../../sandbox/index.ts";

export const PROCESS_SERVER = "process";
export const PROCESS_RUN_TOOL = "run";

const DEFAULT_PROCESS_TIMEOUT_MS = 8_000;
const MAX_PROCESS_TIMEOUT_MS = 30_000;

interface ProcessRunResult extends Record<string, unknown> {
    executable: string;
    argv: string[];
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    truncated: boolean;
    durationMs: number;
    error?: string;
}

/**
 * Cross-platform process execution for coding tools.
 *
 * This is the primary computer-control execution path: callers provide one
 * executable plus argv. Shell syntax is intentionally not parsed here; the
 * high-risk shell escape hatch remains a separate tool and approval surface.
 */
export class ProcessToolset {
    public constructor(private readonly paths: FlyflorPaths) {}

    public serverDefinition(): McpServerDefinition {
        return {
            name: PROCESS_SERVER,
            source: "project",
            transport: "builtin",
            enabled: true,
        };
    }

    public catalog(): McpToolCatalogEntry[] {
        return [
            {
                server: PROCESS_SERVER,
                tool: {
                    name: PROCESS_RUN_TOOL,
                    description:
                        "Run a local executable with explicit argv. This is the primary cross-platform process tool and does not interpret shell syntax.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            executable: { type: "string" },
                            argv: { type: "array", items: { type: "string" } },
                            cwd: { type: "string" },
                            stdin: { type: "string" },
                            timeoutMs: { type: "number" },
                        },
                        required: ["executable"],
                    },
                },
            },
        ];
    }

    public canHandle(call: McpToolCallRequest): boolean {
        return call.server === PROCESS_SERVER;
    }

    public async execute(call: McpToolCallRequest, executor: ShellHookExecutor): Promise<McpCallResult> {
        if (call.tool !== PROCESS_RUN_TOOL) {
            return {
                isError: true,
                raw: { error: `Unknown process tool: ${call.tool}` },
            };
        }
        const spec = this.readRunSpec(call);
        if (!spec.ok) {
            return { isError: true, raw: { error: spec.error } };
        }
        const result = await executor.execute({
            id: `${PROCESS_SERVER}.${PROCESS_RUN_TOOL}`,
            command: spec.executable,
            args: spec.argv,
            cwd: spec.cwd,
            stdin: spec.stdin,
            timeoutMs: spec.timeoutMs,
        });
        return {
            isError: !result.ok,
            raw: this.toRunResult(spec, result),
        };
    }

    public executableInput(call: McpToolCallRequest): string {
        const executable = call.input.executable;
        if (typeof executable !== "string" || executable.trim().length === 0) {
            throw new Error("process.run requires input.executable.");
        }
        return executable.trim();
    }

    private readRunSpec(call: McpToolCallRequest):
        | { ok: true; executable: string; argv: string[]; cwd: string; stdin?: string; timeoutMs?: number }
        | { ok: false; error: string } {
        let executable: string;
        try {
            executable = this.executableInput(call);
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        if (/[\r\n]/u.test(executable)) {
            return { ok: false, error: "process.run input.executable must be one executable, not a script." };
        }
        const argv = call.input.argv;
        if (argv !== undefined && (!Array.isArray(argv) || argv.some((item) => typeof item !== "string"))) {
            return { ok: false, error: "process.run input.argv must be string[]." };
        }
        const cwd = call.input.cwd;
        if (cwd !== undefined && typeof cwd !== "string") return { ok: false, error: "process.run input.cwd must be a string." };
        const stdin = call.input.stdin;
        if (stdin !== undefined && typeof stdin !== "string") return { ok: false, error: "process.run input.stdin must be a string." };
        const timeoutMs = call.input.timeoutMs;
        if (timeoutMs !== undefined && typeof timeoutMs !== "number") return { ok: false, error: "process.run input.timeoutMs must be a number." };
        return {
            ok: true,
            executable,
            argv: Array.isArray(argv) ? argv : [],
            cwd: typeof cwd === "string" && cwd.trim() ? cwd.trim() : this.paths.projectDir,
            stdin,
            timeoutMs: this.clampedTimeout(timeoutMs),
        };
    }

    private toRunResult(
        spec: { executable: string; argv: string[]; cwd: string },
        result: ShellHookResult,
    ): ProcessRunResult {
        return {
            executable: spec.executable,
            argv: spec.argv,
            cwd: spec.cwd,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            truncated: result.truncated,
            durationMs: result.durationMs,
            error: result.error,
        };
    }

    private clampedTimeout(value: unknown): number {
        if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PROCESS_TIMEOUT_MS;
        return Math.max(1, Math.min(MAX_PROCESS_TIMEOUT_MS, Math.floor(value)));
    }
}
