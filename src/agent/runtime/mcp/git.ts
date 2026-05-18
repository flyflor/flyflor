import type { FlyflorPaths } from "../../../config/index.ts";
import type { McpCallResult, McpServerDefinition, McpToolCallRequest, McpToolCatalogEntry } from "../../mcp/index.ts";
import type { ShellHookExecutor } from "../../sandbox/index.ts";

export const GIT_SERVER = "git";

const GIT_STATUS_TOOL = "status";
const GIT_DIFF_TOOL = "diff";
const GIT_SHOW_TOOL = "show";
const DEFAULT_GIT_TIMEOUT_MS = 8_000;
const MAX_GIT_CONTEXT_LINES = 20;

interface GitCommandResult extends Record<string, unknown> {
    command: "git";
    args: string[];
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    truncated: boolean;
    durationMs: number;
    error?: string;
}

export class GitToolset {
    public constructor(private readonly paths: FlyflorPaths) {}

    public serverDefinition(): McpServerDefinition {
        return {
            name: GIT_SERVER,
            source: "project",
            transport: "builtin",
            enabled: true,
        };
    }

    public catalog(): McpToolCatalogEntry[] {
        return [
            {
                server: GIT_SERVER,
                tool: {
                    name: GIT_STATUS_TOOL,
                    description: "Read-only git status for the current project.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            timeoutMs: { type: "number" },
                        },
                    },
                },
            },
            {
                server: GIT_SERVER,
                tool: {
                    name: GIT_DIFF_TOOL,
                    description: "Bounded read-only git diff for the current project.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            cached: { type: "boolean" },
                            context: { type: "number" },
                            path: { type: "string" },
                            timeoutMs: { type: "number" },
                        },
                    },
                },
            },
            {
                server: GIT_SERVER,
                tool: {
                    name: GIT_SHOW_TOOL,
                    description: "Bounded read-only git commit/object metadata and patch.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            revision: { type: "string" },
                            path: { type: "string" },
                            timeoutMs: { type: "number" },
                        },
                    },
                },
            },
        ];
    }

    public canHandle(call: McpToolCallRequest): boolean {
        return call.server === GIT_SERVER;
    }

    public async execute(call: McpToolCallRequest, executor: ShellHookExecutor): Promise<McpCallResult> {
        if (call.tool === GIT_STATUS_TOOL) {
            return { raw: await this.status(call.input, executor) };
        }
        if (call.tool === GIT_DIFF_TOOL) {
            return { raw: await this.diff(call.input, executor) };
        }
        if (call.tool === GIT_SHOW_TOOL) {
            return { raw: await this.show(call.input, executor) };
        }
        return {
            isError: true,
            raw: { error: `Unknown git tool: ${call.tool}` },
        };
    }

    private async status(input: Record<string, unknown>, executor: ShellHookExecutor): Promise<Record<string, unknown>> {
        const args = ["status", "--short", "--branch", "--untracked-files=all"];
        const result = await this.runGit(executor, GIT_STATUS_TOOL, args, input);
        return {
            ...result,
            branch: this.parseStatusBranch(result.stdout),
            files: this.parseStatusFiles(result.stdout),
        };
    }

    private async diff(input: Record<string, unknown>, executor: ShellHookExecutor): Promise<Record<string, unknown>> {
        const args = ["diff", "--no-ext-diff"];
        const context = this.clampedNumber(input.context, undefined, MAX_GIT_CONTEXT_LINES);
        if (context !== undefined) {
            args.push(`--unified=${context}`);
        }
        if (input.cached === true) {
            args.push("--cached");
        }
        const path = this.optionalString(input.path);
        if (path) {
            args.push("--", path);
        }
        return this.runGit(executor, GIT_DIFF_TOOL, args, input);
    }

    private async show(input: Record<string, unknown>, executor: ShellHookExecutor): Promise<Record<string, unknown>> {
        const revision = this.optionalString(input.revision) ?? "HEAD";
        const args = ["show", "--no-ext-diff", "--stat", "--patch", "--format=fuller", "--end-of-options", revision];
        const path = this.optionalString(input.path);
        if (path) {
            args.push("--", path);
        }
        return this.runGit(executor, GIT_SHOW_TOOL, args, input);
    }

    private async runGit(
        executor: ShellHookExecutor,
        tool: string,
        args: string[],
        input: Record<string, unknown>,
    ): Promise<GitCommandResult> {
        const result = await executor.execute({
            id: `${GIT_SERVER}.${tool}`,
            command: "git",
            args,
            cwd: this.paths.projectDir,
            timeoutMs: this.clampedNumber(input.timeoutMs, DEFAULT_GIT_TIMEOUT_MS, DEFAULT_GIT_TIMEOUT_MS),
        });
        return {
            command: "git",
            args,
            cwd: this.paths.projectDir,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            truncated: result.truncated,
            durationMs: result.durationMs,
            error: result.error,
        };
    }

    private parseStatusBranch(stdout: string): string | undefined {
        const first = stdout.split(/\r?\n/u)[0]?.trim();
        return first?.startsWith("## ") ? first.slice(3) : undefined;
    }

    private parseStatusFiles(stdout: string): Array<{ path: string; status: string }> {
        const lines = stdout.split(/\r?\n/u).filter((line) => line && !line.startsWith("## "));
        return lines.map((line) => ({
            status: line.slice(0, 2),
            path: line.slice(3),
        }));
    }

    private optionalString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    }

    private clampedNumber(value: unknown, fallback: number | undefined, max: number): number | undefined {
        if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
        return Math.max(0, Math.min(max, Math.floor(value)));
    }
}
