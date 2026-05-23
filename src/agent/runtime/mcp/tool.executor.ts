import { resolve } from "node:path";
import type { FlyflorConfig } from "../../../config/index.ts";
import {
    CapabilityExecutionKind,
    ExecutiveLoopGuardReason,
} from "../../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../../events/index.ts";
import {
    callMcpTool,
    describeMcpResult,
    loadMcpServers,
    validateAgainstInputSchema,
    type McpToolCallExecution,
    type McpToolCallRequest,
    type McpToolCatalogEntry,
} from "../../mcp/index.ts";
import {
    createSandboxPolicy,
    gateCapabilityExecution,
    SandboxQuotaTracker,
    ShellHookExecutor,
} from "../../sandbox/index.ts";
import {
    ExecutiveToolRuntime,
    ComputerProfileComponent,
    McpCatalogAdapter,
    type ExecutiveLoopGuardDecision,
    type ExecutiveToolRuntimeAskRequired,
    type ExecutiveToolRuntimeDescriptor,
} from "../../../executive/index.ts";
import type { ManifestToolDefinition } from "../../../executive/index.ts";
import { PluginRunner } from "../../plugin/index.ts";
import { formatMcpResultSummary } from "./provenance.ts";
import { type RuntimePluginCapabilityCatalogEntry, type RuntimeUserToolCatalogEntry } from "./tool.plan.ts";
import { USER_TOOL_SERVER, invokeUserTool } from "./user.tool.ts";
import { type WorkspaceToolAccess, WorkspaceToolset } from "./workspace.ts";
import { GitToolset } from "./git.ts";
import { ProcessToolset, PROCESS_SERVER } from "./process.ts";

const BUILTIN_SHELL_SERVER = "shell";
const BUILTIN_SHELL_TOOL = "run";

export interface RuntimeMcpToolExecutorInput {
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    approveUserToolCall?: (tool: ManifestToolDefinition) => boolean | Promise<boolean>;
    catalog: McpToolCatalogEntry[];
    gitToolset: GitToolset;
    processToolset: ProcessToolset;
    pluginCapabilityCatalog: RuntimePluginCapabilityCatalogEntry[];
    requiresApproval: boolean;
    requestId: string;
    userToolCatalog: RuntimeUserToolCatalogEntry[];
    workspaceToolset: WorkspaceToolset;
}

export interface RuntimeMcpToolLoopInput {
    generate: (messages: unknown[], turn: number) => Promise<string>;
    initialMessages: unknown[];
    maxTurns: number;
    noMoreToolsMessage: string;
    parse: (raw: string) => { calls: McpToolCallRequest[]; text: string };
    renderResults: (executions: McpToolCallExecution[]) => string;
    toolExecution: RuntimeMcpToolExecutorInput;
}

export interface RuntimeMcpToolLoopResult {
    askRequired?: ExecutiveToolRuntimeAskRequired;
    mcpToolCalls: McpToolCallExecution[];
    rawText: string;
}

/**
 * Runtime-facing adapter for ExecutiveToolRuntime.
 *
 * Runtime owns turn orchestration; this class binds Flyflor's concrete tool
 * adapters to the Executive loop without making Executive import runtime code.
 */
export class RuntimeMcpToolExecutor {
    private readonly executive = new ExecutiveToolRuntime<McpToolCallRequest & { key: string }, McpToolCallExecution & { call: McpToolCallRequest & { key: string } }>();
    private readonly computerProfile = new ComputerProfileComponent();
    private readonly adapter = new McpCatalogAdapter({
        coreServers: new Set(["workspace", "git", PROCESS_SERVER, BUILTIN_SHELL_SERVER]),
        gitServer: "git",
        shellServer: BUILTIN_SHELL_SERVER,
        workspaceServer: "workspace",
    });

    public constructor(
        private readonly config: FlyflorConfig,
        private readonly events: EventSink,
        private readonly sandboxQuota: SandboxQuotaTracker,
    ) {}

    public async runLoop(input: RuntimeMcpToolLoopInput): Promise<RuntimeMcpToolLoopResult> {
        const result = await this.executive.run({
            initialMessages: input.initialMessages,
            loopGuard: { maxUnknownToolRepeats: 1 },
            maxTurns: input.maxTurns,
            noMoreToolsMessage: input.noMoreToolsMessage,
            callbacks: {
                execute: (calls) => this.executeCalls(calls, input.toolExecution),
                generate: input.generate,
                knownToolNames: () => this.catalogKeys(input.toolExecution.catalog),
                onExecution: (execution, options) =>
                    this.publishMcpToolCallExecution(execution, input.toolExecution.requestId, options.loopGuardBlocked ? false : input.toolExecution.requiresApproval),
                onLoopGuardBlocked: (call, decision) => this.loopGuardExecution(call, decision, input.toolExecution.requestId),
                parse: (raw) => {
                    const parsed = input.parse(raw);
                    return {
                        text: parsed.text,
                        calls: parsed.calls.map((call) => ({ ...call, key: this.callKey(call) })),
                    };
                },
                renderResults: (executions) => input.renderResults(executions),
                toolDescriptor: (call) => this.toolRuntimeDescriptor(call, input.toolExecution.catalog),
            },
        });
        return {
            askRequired: result.askRequired,
            rawText: result.rawText,
            mcpToolCalls: result.executions,
        };
    }

    public async executeCalls(
        calls: readonly (McpToolCallRequest & { key?: string })[],
        input: RuntimeMcpToolExecutorInput,
    ): Promise<Array<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }>> {
        const catalogKeys = this.catalogKeys(input.catalog);
        const catalogByKey = new Map<string, McpToolCatalogEntry>(
            input.catalog.map((entry) => [`${entry.server}.${entry.tool.name}`, entry]),
        );
        const servers = await loadMcpServers(this.config.paths);
        const sandboxPolicy = createSandboxPolicy(this.config.sandbox);
        const executions: Array<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> = [];
        for (const rawCall of calls) {
            const call = { ...rawCall, key: rawCall.key ?? this.callKey(rawCall) };
            const key = this.callKey(call);
            const descriptor = { server: call.server, tool: call.tool };
            const catalogEntry = catalogByKey.get(key);
            const schemaCheck = catalogEntry
                ? validateAgainstInputSchema(catalogEntry.tool.inputSchema, call.input)
                : { ok: true, errors: [] };
            if (input.workspaceToolset.canHandle(call)) {
                executions.push(await this.executeWorkspaceToolCall(
                    call,
                    input.workspaceToolset,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["workspace tool not in catalog"] },
                    input.requestId,
                    input.approveMcpToolCall,
                ));
                continue;
            }
            if (input.gitToolset.canHandle(call)) {
                executions.push(await this.executeGitToolCall(
                    call,
                    input.gitToolset,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["git tool not in catalog"] },
                    input.approveMcpToolCall,
                ));
                continue;
            }
            if (input.processToolset.canHandle(call)) {
                executions.push(await this.executeProcessToolCall(
                    call,
                    input.processToolset,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["process tool not in catalog"] },
                    input.approveMcpToolCall,
                ));
                continue;
            }
            if (key === `${BUILTIN_SHELL_SERVER}.${BUILTIN_SHELL_TOOL}`) {
                executions.push(await this.executeBuiltinShellToolCall(
                    call,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["shell.run not in catalog"] },
                    input.approveMcpToolCall,
                ));
                continue;
            }
            const userTool = input.userToolCatalog.find(
                (entry) => call.server === USER_TOOL_SERVER && entry.tool.descriptor.name === call.tool,
            );
            if (userTool) {
                executions.push(await this.executeUserToolCall(
                    call,
                    userTool.tool,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["user tool not in catalog"] },
                    input.approveUserToolCall,
                ));
                continue;
            }
            const pluginCapability = input.pluginCapabilityCatalog.find(
                (entry) => call.server === USER_TOOL_SERVER && entry.descriptor.name === call.tool,
            );
            if (pluginCapability) {
                executions.push(await this.executePluginCapabilityCall(
                    call,
                    pluginCapability,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["plugin capability not in catalog"] },
                    input.approveMcpToolCall,
                ));
                continue;
            }
            const server = servers.find((candidate) => candidate.name === call.server);
            const preDeny =
                !catalogKeys.has(key) || !server
                    ? {
                          reason: "tool-not-in-catalog",
                          message: `MCP tool is not available this turn: ${key}`,
                      }
                    : !schemaCheck.ok
                      ? {
                            reason: "input-schema-violation",
                            message: `MCP tool input violates inputSchema for ${key}: ${schemaCheck.errors.join("; ")}`,
                        }
                      : undefined;
            const gate = await gateCapabilityExecution({
                policy: sandboxPolicy,
                kind: this.executionKindForCall(call, catalogEntry),
                events: this.events,
                requestId: input.requestId,
                descriptor,
                preDeny,
                approve: input.approveMcpToolCall ? () => input.approveMcpToolCall!(call) : undefined,
                deniedMessage: `MCP tool call was not approved: ${key}`,
                quota: this.sandboxQuota,
            });
            if (!gate.allowed) {
                executions.push({ call, ok: false, error: gate.reason });
                continue;
            }
            try {
                executions.push({
                    call,
                    ok: true,
                    result: await callMcpTool(this.config.paths, server!, call.tool, call.input, {
                        events: this.events,
                        requestId: input.requestId,
                        timeoutMs: 8_000,
                    }),
                });
            } catch (error) {
                executions.push({
                    call,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return executions;
    }

    private async executeWorkspaceToolCall(
        call: McpToolCallRequest & { key: string },
        workspaceToolset: WorkspaceToolset,
        schemaCheck: { ok: boolean; errors: string[] },
        requestId: string,
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return {
                call,
                ok: false,
                error: `workspace tool input violates inputSchema: ${schemaCheck.errors.join("; ")}`,
            };
        }
        try {
            const access = await this.approveWorkspaceAccess(call, workspaceToolset, requestId, approveMcpToolCall);
            if (!access.approved) {
                return { call, ok: false, error: access.reason };
            }
            const result = await workspaceToolset.executeWithAccess(call, access);
            return {
                call,
                ok: !result.isError,
                result,
                error: result.isError ? this.workspaceToolError(result.raw) : undefined,
            };
        } catch (error) {
            return { call, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    private async approveWorkspaceAccess(
        call: McpToolCallRequest,
        workspaceToolset: WorkspaceToolset,
        requestId: string,
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
    ): Promise<WorkspaceToolAccess> {
        const requested = await workspaceToolset.requiresApproval(call);
        if (!requested) return { approved: true, reason: "project-local" };
        const descriptor = { server: call.server, tool: call.tool, path: requested.path, target: requested.target };
        this.events.publish(
            event(
                RuntimeEventType.SandboxToolApprovalRequested,
                { kind: workspaceToolset.isWriteTool(call.tool) ? "workspace-write" : "workspace-read", ...descriptor },
                requestId,
            ),
        );
        const approved = approveMcpToolCall ? await approveMcpToolCall(call) : false;
        if (!approved) {
            this.events.publish(
                event(
                    RuntimeEventType.SandboxToolApprovalDenied,
                    { kind: workspaceToolset.isWriteTool(call.tool) ? "workspace-write" : "workspace-read", ...descriptor },
                    requestId,
                ),
            );
            return { approved: false, reason: `workspace access was not approved: ${requested.target}` };
        }
        return { approved: true, reason: workspaceToolset.isWriteTool(call.tool) ? "approved-computer-control" : "approved-outside-project" };
    }

    private workspaceToolError(raw: unknown): string {
        if (raw && typeof raw === "object" && "error" in raw) {
            const value = (raw as { error?: unknown }).error;
            if (typeof value === "string") return value;
        }
        return "workspace tool returned an error.";
    }

    private async executeUserToolCall(
        call: McpToolCallRequest & { key: string },
        tool: ManifestToolDefinition,
        schemaCheck: { ok: boolean; errors: string[] },
        approveUserToolCall?: (tool: ManifestToolDefinition) => boolean | Promise<boolean>,
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `user tool input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        const result = await invokeUserTool({
            approve: approveUserToolCall,
            events: this.events,
            input: call.input,
            paths: this.config.paths,
            policy: createSandboxPolicy(this.config.sandbox),
            tool,
        });
        return {
            call,
            ok: result.ok,
            result: {
                isError: !result.ok,
                raw: {
                    response: result.response,
                    exitCode: result.exitCode,
                    timedOut: result.timedOut,
                    stderr: result.stderr,
                    truncated: result.truncated,
                    durationMs: result.durationMs,
                    error: result.error,
                },
            },
            error: result.error,
        };
    }

    private async executePluginCapabilityCall(
        call: McpToolCallRequest & { key: string },
        capability: RuntimePluginCapabilityCatalogEntry,
        schemaCheck: { ok: boolean; errors: string[] },
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `plugin capability input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        const command = this.pluginCommand();
        const runner = new PluginRunner({
            policy: createSandboxPolicy(this.config.sandbox),
            events: this.events,
            allowedCommands: [command],
            approve: approveMcpToolCall ? () => approveMcpToolCall(call) : undefined,
        });
        const result = await runner.invoke({
            plugin: {
                capabilities: [],
                name: capability.plugin,
                entry: capability.entry,
                enabled: capability.enabled,
                source: capability.source === "global" ? "global" : "project",
                description: capability.descriptor.description,
            },
            command,
            args: [this.resolvePluginEntry(capability)],
            cwd: this.config.paths.projectDir,
            env: {},
            request: {
                capability: capability.descriptor.name,
                input: call.input,
                plugin: capability.plugin,
                projectDir: this.config.paths.projectDir,
                configDir: this.config.paths.configDir,
            },
        });
        return {
            call,
            ok: result.ok,
            result: {
                isError: !result.ok,
                raw: {
                    response: result.response,
                    exitCode: result.exitCode,
                    timedOut: result.timedOut,
                    stderr: result.stderr,
                    truncated: result.truncated,
                    durationMs: result.durationMs,
                    error: result.error,
                },
            },
            error: result.error,
        };
    }

    private async executeGitToolCall(
        call: McpToolCallRequest & { key: string },
        gitToolset: GitToolset,
        schemaCheck: { ok: boolean; errors: string[] },
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `git tool input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        const executor = new ShellHookExecutor({
            policy: createSandboxPolicy(this.config.sandbox),
            events: this.events,
            allowedCommands: ["git"],
            approve: approveMcpToolCall ? () => approveMcpToolCall(call) : undefined,
        });
        try {
            const result = await gitToolset.execute(call, executor);
            const error = result.isError ? this.workspaceToolError(result.raw) : this.gitToolError(result.raw);
            return {
                call,
                ok: !result.isError && !error,
                result: { isError: result.isError || Boolean(error), raw: result.raw },
                error,
            };
        } catch (error) {
            return { call, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    private async executeProcessToolCall(
        call: McpToolCallRequest & { key: string },
        processToolset: ProcessToolset,
        schemaCheck: { ok: boolean; errors: string[] },
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `process tool input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        let executable: string;
        try {
            executable = processToolset.executableInput(call);
        } catch (error) {
            return { call, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        const executor = new ShellHookExecutor({
            policy: createSandboxPolicy(this.config.sandbox),
            events: this.events,
            allowedCommands: [executable],
            approve: approveMcpToolCall ? () => approveMcpToolCall(call) : undefined,
        });
        try {
            const result = await processToolset.execute(call, executor);
            const error = result.isError ? this.processToolError(result.raw) : undefined;
            return {
                call,
                ok: !result.isError,
                result,
                error,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                call,
                ok: false,
                result: {
                    isError: true,
                    raw: {
                        executable,
                        argv: Array.isArray(call.input.argv) ? call.input.argv : [],
                        cwd: typeof call.input.cwd === "string" && call.input.cwd.trim() ? call.input.cwd.trim() : this.config.paths.projectDir,
                        stdout: "",
                        stderr: "",
                        exitCode: null,
                        timedOut: false,
                        truncated: false,
                        durationMs: 0,
                        error: message,
                    },
                },
                error: message,
            };
        }
    }

    private processToolError(raw: unknown): string {
        if (raw && typeof raw === "object") {
            const value = raw as { error?: unknown; exitCode?: unknown; stderr?: unknown; executable?: unknown; timedOut?: unknown };
            if (typeof value.error === "string") return value.error;
            if (value.timedOut === true) return "process.run timed out.";
            if (typeof value.exitCode === "number" && value.exitCode !== 0) {
                const stderr = typeof value.stderr === "string" && value.stderr.trim() ? `: ${value.stderr.trim().slice(0, 240)}` : "";
                return `process.run exited with code ${value.exitCode}${stderr}`;
            }
        }
        return "process.run failed.";
    }

    private gitToolError(raw: unknown): string | undefined {
        if (!raw || typeof raw !== "object") return undefined;
        const value = raw as { error?: unknown; exitCode?: unknown; timedOut?: unknown };
        if (typeof value.error === "string") return value.error;
        if (value.timedOut === true) return "git tool timed out.";
        if (typeof value.exitCode === "number" && value.exitCode !== 0) {
            return `git exited with code ${value.exitCode}`;
        }
        return undefined;
    }

    private async executeBuiltinShellToolCall(
        call: McpToolCallRequest & { key: string },
        schemaCheck: { ok: boolean; errors: string[] },
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `shell.run input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        const spec = this.readShellRunSpec(call);
        if (!spec.ok) return { call, ok: false, error: spec.error };
        const executor = new ShellHookExecutor({
            policy: createSandboxPolicy(this.config.sandbox),
            events: this.events,
            allowedCommands: [spec.command],
            approve: approveMcpToolCall ? () => approveMcpToolCall(call) : undefined,
        });
        const result = await executor.execute({
            id: `${BUILTIN_SHELL_SERVER}.${BUILTIN_SHELL_TOOL}`,
            command: spec.command,
            args: spec.args,
            cwd: spec.cwd,
            stdin: spec.stdin,
            timeoutMs: spec.timeoutMs,
        });
        return {
            call,
            ok: result.ok,
            result: {
                isError: !result.ok,
                raw: {
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exitCode: result.exitCode,
                    timedOut: result.timedOut,
                    truncated: result.truncated,
                    durationMs: result.durationMs,
                    error: result.error,
                },
            },
            error: result.error,
        };
    }

    private readShellRunSpec(call: McpToolCallRequest):
        | { ok: true; command: string; args: string[]; cwd: string; stdin?: string; timeoutMs?: number }
        | { ok: false; error: string } {
        const command = call.input.command;
        if (typeof command !== "string" || command.trim().length === 0) {
            return { ok: false, error: "shell.run requires input.command." };
        }
        const commandText = command.trim();
        if (/[\r\n]/u.test(commandText)) {
            return { ok: false, error: "shell.run input.command must be a single executable, not a script." };
        }
        const args = call.input.args;
        if (args !== undefined && (!Array.isArray(args) || args.some((item) => typeof item !== "string"))) {
            return { ok: false, error: "shell.run input.args must be string[]." };
        }
        const cwd = call.input.cwd;
        if (cwd !== undefined && typeof cwd !== "string") return { ok: false, error: "shell.run input.cwd must be a string." };
        const stdin = call.input.stdin;
        if (stdin !== undefined && typeof stdin !== "string") return { ok: false, error: "shell.run input.stdin must be a string." };
        const timeoutMs = call.input.timeoutMs;
        if (timeoutMs !== undefined && typeof timeoutMs !== "number") return { ok: false, error: "shell.run input.timeoutMs must be a number." };
        return {
            ok: true,
            command: commandText,
            args: Array.isArray(args) ? args : [],
            cwd: typeof cwd === "string" && cwd.trim() ? cwd.trim() : this.config.paths.projectDir,
            stdin,
            timeoutMs,
        };
    }

    private publishMcpToolCallExecution(
        execution: McpToolCallExecution,
        requestId: string,
        requiresApproval: boolean,
    ): void {
        const resultDescription = execution.result ? describeMcpResult(execution.result.raw) : undefined;
        this.events.publish(
            event(
                RuntimeEventType.McpToolCallExecuted,
                {
                    error: execution.error,
                    ok: execution.ok,
                    requiresApproval,
                    ...(resultDescription
                        ? {
                              resultSummary: formatMcpResultSummary(resultDescription.summary, execution.result?.raw),
                              resultSummaryMeta: resultDescription.summary,
                          }
                        : {}),
                    server: execution.call.server,
                    tool: execution.call.tool,
                },
                requestId,
            ),
        );
    }

    private loopGuardExecution(
        call: McpToolCallRequest,
        decision: ExecutiveLoopGuardDecision,
        requestId: string,
    ): McpToolCallExecution & { call: McpToolCallRequest & { key: string } } {
        this.events.publish(
            event(RuntimeEventType.ExecutiveLoopGuardBlocked, {
                message: decision.message,
                reason: decision.reason ?? ExecutiveLoopGuardReason.RepeatedCallNoProgress,
                server: call.server,
                tool: call.tool,
            }, requestId),
        );
        return {
            call: { ...call, key: this.callKey(call) },
            ok: false,
            error: decision.message ?? "Executive loop guard blocked this tool call.",
            result: {
                isError: true,
                raw: {
                    kind: "executive-loop-guard",
                    message: decision.message,
                    reason: decision.reason ?? ExecutiveLoopGuardReason.RepeatedCallNoProgress,
                    server: call.server,
                    tool: call.tool,
                },
            },
        };
    }

    private toolRuntimeDescriptor(
        call: McpToolCallRequest,
        catalog: readonly McpToolCatalogEntry[],
    ): ExecutiveToolRuntimeDescriptor | undefined {
        const entry = catalog.find((candidate) => candidate.server === call.server && candidate.tool.name === call.tool);
        if (!entry) return undefined;
        const descriptor = this.descriptorFromEntry(entry);
        return {
            concurrencySafe: descriptor.concurrencySafe,
            exclusive: descriptor.exclusive,
            readOnly: descriptor.readOnly,
        };
    }

    private descriptorFromEntry(entry: McpToolCatalogEntry): {
        concurrencySafe: boolean;
        exclusive: boolean;
        readOnly: boolean;
    } {
        if (entry.server === BUILTIN_SHELL_SERVER) {
            return { concurrencySafe: false, exclusive: true, readOnly: false };
        }
        if (entry.server === PROCESS_SERVER) {
            return { concurrencySafe: false, exclusive: true, readOnly: false };
        }
        if (entry.server === "git") {
            return { concurrencySafe: false, exclusive: false, readOnly: true };
        }
        if (entry.server === "workspace" && this.isWorkspaceWriteTool(entry.tool.name)) {
            return { concurrencySafe: false, exclusive: false, readOnly: false };
        }
        if (entry.server === USER_TOOL_SERVER) {
            return { concurrencySafe: false, exclusive: true, readOnly: false };
        }
        return { concurrencySafe: true, exclusive: false, readOnly: true };
    }

    private executionKindForCall(
        call: McpToolCallRequest,
        catalogEntry: McpToolCatalogEntry | undefined,
    ): CapabilityExecutionKind {
        if (!catalogEntry) {
            return CapabilityExecutionKind.McpTool;
        }
        const descriptor = this.adapter.descriptorFor(catalogEntry);
        return this.computerProfile.isComputerControlled(descriptor)
            ? CapabilityExecutionKind.Computer
            : CapabilityExecutionKind.McpTool;
    }

    private catalogKeys(catalog: readonly McpToolCatalogEntry[]): ReadonlySet<string> {
        return new Set(catalog.map((entry) => `${entry.server}.${entry.tool.name}`));
    }

    private callKey(call: Pick<McpToolCallRequest, "server" | "tool">): string {
        return `${call.server}.${call.tool}`;
    }

    private isWorkspaceWriteTool(toolName: string): boolean {
        return toolName === "write" || toolName === "edit" || toolName === "delete" || toolName === "patch";
    }

    private pluginCommand(): string {
        return Bun.argv[0] ?? "bun";
    }

    private resolvePluginEntry(capability: RuntimePluginCapabilityCatalogEntry): string {
        if (capability.entry.startsWith("/")) return capability.entry;
        const baseDir = capability.source === "global" ? this.config.paths.pluginDir : this.config.paths.projectPluginDir;
        return resolve(baseDir, capability.entry);
    }
}
