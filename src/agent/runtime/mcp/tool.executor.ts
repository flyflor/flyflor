import { resolve } from "node:path";
import type { FlyflorConfig } from "../../../config/index.ts";
import type { ModelMessage } from "../../../protocol/contracts/index.ts";
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
    type SandboxPolicy,
    SandboxQuotaTracker,
    ShellHookExecutor,
} from "../../sandbox/index.ts";
import {
    ExecutiveToolRuntime,
    ComputerProfileComponent,
    type ExecutionJobToolExecution,
    McpCatalogAdapter,
    type ExternalToolStability,
    type ExecutiveLoopGuardDecision,
    type ExecutiveLoopGuardOptions,
    type ExecutiveLoopGuardSnapshot,
    type ExecutiveToolBudgetExhaustedReason,
    type ExecutiveToolRuntimeBudget,
    type ExecutiveToolRuntimeBudgetSnapshot,
    type ExecutiveToolRuntimeBudgetDecision,
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
import {
    RuntimeSubagentBatchComponent,
    SUBAGENT_BATCH_KEY,
    SUBAGENT_BATCH_TOOL,
    SUBAGENT_SERVER,
    type SubagentBatchResult,
    type SubagentTask,
} from "../subagent/index.ts";

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
    ownerKey?: string;
    sandboxPolicy?: SandboxPolicy;
    sourceKey?: string;
    subagentBatch?: RuntimeSubagentBatchComponent;
    subagentGenerate?: (messages: unknown[], turn: number, child?: SubagentTask) => Promise<string>;
    subagentInitialMessages?: ModelMessage[];
    subagentModel?: {
        modelId: string;
        providerId: string;
        source: string;
    };
    subagentRenderResults?: (executions: McpToolCallExecution[]) => string;
    userToolCatalog: RuntimeUserToolCatalogEntry[];
    workspaceToolset: WorkspaceToolset;
}

export interface RuntimeMcpToolLoopInput {
    budget: ExecutiveToolRuntimeBudget;
    generate: (messages: unknown[], turn: number) => Promise<string>;
    initialMessages: unknown[];
    loopGuard?: ExecutiveLoopGuardOptions;
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
            budget: input.budget,
            initialMessages: input.initialMessages,
            loopGuard: input.loopGuard ?? { maxUnknownToolRepeats: 1 },
            maxTurns: input.maxTurns,
            noMoreToolsMessage: input.noMoreToolsMessage,
            callbacks: {
                execute: (calls) => this.executeCalls(calls, input.toolExecution),
                generate: input.generate,
                knownToolNames: () => this.catalogKeys(input.toolExecution.catalog),
                onBudgetBlocked: (call, decision) => this.budgetExecution(call, decision),
                onExecution: (execution, options) =>
                    this.publishMcpToolCallExecution(
                        execution,
                        input.toolExecution.requestId,
                        options.loopGuardBlocked ? false : input.toolExecution.requiresApproval,
                        this.sandboxPolicyForInput(input.toolExecution).mode,
                    ),
                onExecutionAskRequired: (execution, context) =>
                    this.executionAskRequired(execution, context),
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
        const sandboxPolicy = this.sandboxPolicyForInput(input);
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
                    sandboxPolicy,
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
                    sandboxPolicy,
                ));
                continue;
            }
            if (input.processToolset.canHandle(call)) {
                executions.push(await this.executeProcessToolCall(
                    call,
                    input.processToolset,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["process tool not in catalog"] },
                    input.requestId,
                    input.approveMcpToolCall,
                    sandboxPolicy,
                ));
                continue;
            }
            if (key === `${BUILTIN_SHELL_SERVER}.${BUILTIN_SHELL_TOOL}`) {
                executions.push(await this.executeBuiltinShellToolCall(
                    call,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["shell.run not in catalog"] },
                    input.approveMcpToolCall,
                    sandboxPolicy,
                ));
                continue;
            }
            if (key === SUBAGENT_BATCH_KEY) {
                executions.push(await this.executeSubagentBatchToolCall(
                    call,
                    input,
                    catalogKeys.has(key) ? schemaCheck : { ok: false, errors: ["subagent.batch not in catalog"] },
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
                    sandboxPolicy,
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
                    sandboxPolicy,
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
        sandboxPolicy: SandboxPolicy,
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
            const access = await this.approveWorkspaceAccess(call, workspaceToolset, requestId, sandboxPolicy, approveMcpToolCall);
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
        sandboxPolicy: SandboxPolicy,
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
    ): Promise<WorkspaceToolAccess> {
        const requested = await workspaceToolset.requiresApproval(call);
        if (!requested) return { approved: true, reason: "project-local" };
        if (sandboxPolicy.mode === "yolo") return { approved: true, reason: "yolo" };
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
        sandboxPolicy: SandboxPolicy = createSandboxPolicy(this.config.sandbox),
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `user tool input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        const stability = this.externalToolStability(tool);
        if (stability && stability.effective !== "available" && stability.effective !== "degraded") {
            return {
                call,
                ok: false,
                error: stability.reason ?? "external tool is unavailable",
                result: {
                    isError: true,
                    raw: {
                        error: stability.reason,
                        toolStability: stability,
                    },
                },
            };
        }
        const result = await invokeUserTool({
            approve: approveUserToolCall,
            executionKind: this.computerProfile.isComputerControlled(tool.descriptor)
                ? CapabilityExecutionKind.Computer
                : CapabilityExecutionKind.Plugin,
            events: this.events,
            input: call.input,
            paths: this.config.paths,
            policy: sandboxPolicy,
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

    private externalToolStability(tool: ManifestToolDefinition): ExternalToolStability | undefined {
        const raw = tool.stability;
        if (!raw || typeof raw !== "object") return undefined;
        const effective = (raw as { effective?: unknown }).effective;
        if (
            effective !== "available" &&
            effective !== "degraded" &&
            effective !== "unavailable" &&
            effective !== "disabled"
        ) {
            return undefined;
        }
        return raw as ExternalToolStability;
    }

    private async executePluginCapabilityCall(
        call: McpToolCallRequest & { key: string },
        capability: RuntimePluginCapabilityCatalogEntry,
        schemaCheck: { ok: boolean; errors: string[] },
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
        sandboxPolicy: SandboxPolicy = createSandboxPolicy(this.config.sandbox),
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `plugin capability input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        const command = this.pluginCommand();
        const runner = new PluginRunner({
            policy: sandboxPolicy,
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
        sandboxPolicy: SandboxPolicy = createSandboxPolicy(this.config.sandbox),
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `git tool input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        const executor = new ShellHookExecutor({
            policy: sandboxPolicy,
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
        requestId: string,
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
        sandboxPolicy: SandboxPolicy = createSandboxPolicy(this.config.sandbox),
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
            policy: sandboxPolicy,
            events: this.events,
            allowedCommands: [executable],
            approve: approveMcpToolCall ? () => approveMcpToolCall(call) : undefined,
        });
        const processSpec = {
            executable,
            argv: Array.isArray(call.input.argv) ? call.input.argv : [],
            cwd: typeof call.input.cwd === "string" && call.input.cwd.trim() ? call.input.cwd.trim() : this.config.paths.projectDir,
        };
        this.events.publish(
            event(RuntimeEventType.ProcessStart, {
                ...processSpec,
                key: this.callKey(call),
                server: call.server,
                tool: call.tool,
            }, requestId),
        );
        try {
            const result = await processToolset.execute(call, executor);
            const error = result.isError ? this.processToolError(result.raw) : undefined;
            const raw = result.raw && typeof result.raw === "object" ? result.raw as Record<string, unknown> : {};
            this.events.publish(
                event(RuntimeEventType.ProcessExit, {
                    ...processSpec,
                    error,
                    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
                    key: this.callKey(call),
                    ok: !result.isError,
                    server: call.server,
                    timedOut: raw.timedOut === true,
                    tool: call.tool,
                }, requestId),
            );
            return {
                call,
                ok: !result.isError,
                result,
                error,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.events.publish(
                event(RuntimeEventType.ProcessExit, {
                    ...processSpec,
                    error: message,
                    exitCode: null,
                    key: this.callKey(call),
                    ok: false,
                    server: call.server,
                    timedOut: false,
                    tool: call.tool,
                }, requestId),
            );
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
        sandboxPolicy: SandboxPolicy = createSandboxPolicy(this.config.sandbox),
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `shell.run input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        const spec = this.readShellRunSpec(call);
        if (!spec.ok) return { call, ok: false, error: spec.error };
        const executor = new ShellHookExecutor({
            policy: sandboxPolicy,
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

    private async executeSubagentBatchToolCall(
        call: McpToolCallRequest & { key: string },
        input: RuntimeMcpToolExecutorInput,
        schemaCheck: { ok: boolean; errors: string[] },
    ): Promise<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }> {
        if (!schemaCheck.ok) {
            return { call, ok: false, error: `subagent.batch input violates inputSchema: ${schemaCheck.errors.join("; ")}` };
        }
        if (!input.subagentBatch || !input.subagentGenerate || !input.subagentInitialMessages || !input.subagentRenderResults) {
            return { call, ok: false, error: "subagent.batch executor is not configured." };
        }
        const parsed = input.subagentBatch.readInput(call.input);
        if (!parsed.ok) return { call, ok: false, error: parsed.error };
        try {
            const result = await input.subagentBatch.run({
                batch: parsed.batch,
                parent: {
                    budget: {
                        modelToolTurnBudget: parsed.batch.maxToolTurns,
                        executionOperationBudget: parsed.batch.maxToolTurns,
                    },
                    catalog: input.catalog,
                    initialMessages: input.subagentInitialMessages,
                    model: input.subagentModel,
                    ownerKey: input.ownerKey,
                    requestId: input.requestId,
                    sourceKey: input.sourceKey,
                },
                child: {
                    approveMcpToolCall: input.approveMcpToolCall,
                    generate: input.subagentGenerate,
                    renderResults: input.subagentRenderResults,
                },
                executeCalls: (calls, catalog, childRequestId) =>
                    this.executeCalls(calls, {
                        ...input,
                        catalog: [...catalog],
                        requestId: childRequestId,
                    }),
                recordToolExecution: (execution, childJobId) => this.executionJobToolExecution(execution, childJobId),
            });
            return {
                call,
                ok: !result.needsUser && result.results.every((item) => item.ok),
                result: {
                    isError: result.needsUser || result.results.some((item) => !item.ok),
                    raw: result.needsUser ? { kind: "subagent-needs-user", ...result } : result,
                },
                error: result.needsUser ? "subagent.batch returned needs_user." : undefined,
            };
        } catch (error) {
            return { call, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    private executionAskRequired(
        execution: McpToolCallExecution,
        context: {
            budget: ExecutiveToolRuntimeBudgetSnapshot;
            loopGuardSnapshot: ExecutiveLoopGuardSnapshot;
            stepCount: number;
        },
    ): ExecutiveToolRuntimeAskRequired | undefined {
        const batch = this.subagentNeedsUserResult(execution);
        if (!batch) {
            return this.toolStabilityAskRequired(execution, context);
        }
        const child = batch.results.find((result) => result.status === "needs_user");
        const childAsk = batch.askRequired ?? child?.askRequired;
        const message = childAsk?.message ?? batch.needsUserReason ?? "A helper task needs user guidance before it can continue.";
        return {
            askId: childAsk?.askId ?? crypto.randomUUID(),
            budget: context.budget,
            budgetExhaustedReason: childAsk?.budgetExhaustedReason,
            crystalCandidate: childAsk?.crystalCandidate ?? {
                kind: "executive-loop-pause",
                reason: "subagent-needs-user",
                summary: message,
            },
            loopGuardReason: childAsk?.loopGuardReason,
            loopGuardSnapshot: childAsk?.loopGuardSnapshot ?? context.loopGuardSnapshot,
            job: childAsk?.job ?? batch.job,
            jobId: childAsk?.jobId ?? batch.jobId,
            message,
            pause: childAsk?.pause ?? {
                mode: "pause",
                options: [{ mode: "continue" }, { mode: "narrow" }, { mode: "stop" }],
            },
            resume: childAsk?.resume ?? { mode: "continue" },
            stepCount: context.stepCount,
            stop: "ask",
            ...(childAsk?.toolBudgetExhausted === true ? { toolBudgetExhausted: true } : {}),
        };
    }

    private toolStabilityAskRequired(
        execution: McpToolCallExecution,
        context: {
            budget: ExecutiveToolRuntimeBudgetSnapshot;
            loopGuardSnapshot: ExecutiveLoopGuardSnapshot;
            stepCount: number;
        },
    ): ExecutiveToolRuntimeAskRequired | undefined {
        const stability = this.toolStabilityResult(execution);
        if (!stability) return undefined;
        const toolName = `${execution.call.server}.${execution.call.tool}`;
        const message = `External tool stability blocked ${toolName}: ${stability.reason ?? stability.effective}.`;
        return {
            askId: crypto.randomUUID(),
            budget: context.budget,
            crystalCandidate: {
                kind: "executive-loop-pause",
                reason: "tool-stability",
                summary: message,
            },
            loopGuardSnapshot: context.loopGuardSnapshot,
            message,
            pause: {
                mode: "pause",
                options: [{ mode: "continue" }, { mode: "narrow" }, { mode: "stop" }],
            },
            resume: { mode: "continue" },
            stepCount: context.stepCount,
            stop: "ask",
            toolStability: stability as unknown as Record<string, unknown>,
        };
    }

    private executionJobToolExecution(
        execution: McpToolCallExecution & {
            call: McpToolCallRequest & { key: string };
            limited?: boolean;
            limitReason?: string;
        },
        childJobId?: string,
    ): ExecutionJobToolExecution {
        const raw = execution.result?.raw;
        return {
            childJobId,
            durationMs: this.durationMs(raw),
            error: execution.error,
            inputPreview: this.previewRecord(execution.call.input),
            key: execution.call.key,
            limited: execution.limited,
            limitReason: execution.limitReason,
            outputPreview: raw === undefined ? undefined : this.previewRecord(raw),
            ok: execution.ok,
            server: execution.call.server,
            tool: execution.call.tool,
        };
    }

    private previewRecord(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== "object") return { value };
        const entries = Object.entries(value as Record<string, unknown>).slice(0, 8);
        return Object.fromEntries(entries.map(([key, item]) => [key, this.previewValue(item)]));
    }

    private previewValue(value: unknown): unknown {
        if (typeof value === "string") return value.slice(0, 240);
        if (Array.isArray(value)) return value.slice(0, 8).map((item) => this.previewValue(item));
        if (value && typeof value === "object") return this.previewRecord(value);
        return value;
    }

    private previewText(value: unknown): string {
        try {
            return (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/gu, " ").trim();
        } catch {
            return String(value);
        }
    }

    private resultTailLines(value: unknown): string[] {
        const text = this.resultTailText(value);
        if (!text) return [];
        return text
            .split(/\r?\n/u)
            .map((line) => line.trimEnd())
            .filter((line) => line.trim().length > 0)
            .slice(-3)
            .map((line) => line.slice(0, 240));
    }

    private resultTailText(value: unknown): string {
        if (value === undefined || value === null) return "";
        if (typeof value === "string") return value;
        if (typeof value === "object") {
            const record = value as Record<string, unknown>;
            const stdout = typeof record.stdout === "string" ? record.stdout : "";
            const stderr = typeof record.stderr === "string" ? record.stderr : "";
            const output = typeof record.output === "string" ? record.output : "";
            const text = [stdout, stderr, output].filter((part) => part.trim().length > 0).join("\n");
            if (text.trim()) return text;
        }
        return this.previewText(value);
    }

    private durationMs(raw: unknown): number {
        if (raw && typeof raw === "object") {
            const value = (raw as { durationMs?: unknown }).durationMs;
            if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
        }
        return 0;
    }

    private subagentNeedsUserResult(execution: McpToolCallExecution): (SubagentBatchResult & { kind: "subagent-needs-user" }) | undefined {
        if (execution.call.server !== SUBAGENT_SERVER || execution.call.tool !== SUBAGENT_BATCH_TOOL) return undefined;
        const raw = execution.result?.raw;
        if (!raw || typeof raw !== "object") return undefined;
        const value = raw as Partial<SubagentBatchResult> & { kind?: unknown };
        if (value.kind !== "subagent-needs-user" || value.needsUser !== true || !Array.isArray(value.results)) {
            return undefined;
        }
        return value as SubagentBatchResult & { kind: "subagent-needs-user" };
    }

    private toolStabilityResult(execution: McpToolCallExecution): ExternalToolStability | undefined {
        if (execution.call.server !== USER_TOOL_SERVER) return undefined;
        const raw = execution.result?.raw;
        if (!raw || typeof raw !== "object") return undefined;
        const value = raw as { toolStability?: unknown };
        const stability = value.toolStability;
        if (!stability || typeof stability !== "object") return undefined;
        const effective = (stability as { effective?: unknown }).effective;
        if (effective !== "unavailable" && effective !== "disabled") return undefined;
        return stability as ExternalToolStability;
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
        sandboxMode: string,
    ): void {
        const resultDescription = execution.result ? describeMcpResult(execution.result.raw) : undefined;
        const key = this.callKey(execution.call);
        const inputPreview = this.previewRecord(execution.call.input);
        const resultTailLines = this.resultTailLines(execution.result?.raw);
        this.events.publish(
            event(
                RuntimeEventType.McpToolCallExecuted,
                {
                    call: {
                        inputPreview,
                        server: execution.call.server,
                        tool: execution.call.tool,
                    },
                    callId: this.executionCallId(requestId, execution.call),
                    displayName: `${execution.call.server}/${execution.call.tool}`,
                    error: execution.error,
                    inputPreview,
                    key,
                    ok: execution.ok,
                    requiresApproval,
                    resultTailLines,
                    sandboxMode,
                    status: execution.ok ? "completed" : "failed",
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
        this.events.publish(
            event(
                execution.ok ? RuntimeEventType.ToolSucceeded : RuntimeEventType.ToolFailed,
                {
                    capabilityKind: this.lifecycleCapabilityKind(execution.call),
                    error: execution.error,
                    inputPreview,
                    key,
                    ok: execution.ok,
                    resultTailLines,
                    sandboxMode,
                    server: execution.call.server,
                    status: execution.ok ? "completed" : "failed",
                    tool: execution.call.tool,
                    ...(resultDescription
                        ? {
                              resultSummary: formatMcpResultSummary(resultDescription.summary, execution.result?.raw),
                              resultSummaryMeta: resultDescription.summary,
                          }
                        : {}),
                },
                requestId,
            ),
        );
    }

    private lifecycleCapabilityKind(call: McpToolCallRequest): CapabilityExecutionKind {
        if (call.server === USER_TOOL_SERVER) return CapabilityExecutionKind.Plugin;
        return CapabilityExecutionKind.McpTool;
    }

    private sandboxPolicyForInput(input: RuntimeMcpToolExecutorInput): SandboxPolicy {
        return input.sandboxPolicy ?? createSandboxPolicy(this.config.sandbox);
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

    private budgetExecution(
        call: McpToolCallRequest,
        decision: ExecutiveToolRuntimeBudgetDecision,
    ): McpToolCallExecution & { call: McpToolCallRequest & { key: string } } {
        return {
            call: { ...call, key: this.callKey(call) },
            ok: false,
            error: decision.message,
            result: {
                isError: true,
                raw: {
                    budget: decision.budget,
                    kind: "executive-tool-budget",
                    message: decision.message,
                    reason: decision.reason satisfies ExecutiveToolBudgetExhaustedReason,
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
            batchBudgetUnit: descriptor.batchBudgetUnit,
            concurrencySafe: descriptor.concurrencySafe,
            exclusive: descriptor.exclusive,
            readOnly: descriptor.readOnly,
            risk: descriptor.readOnly && !descriptor.exclusive ? "low" : "high",
        };
    }

    private descriptorFromEntry(entry: McpToolCatalogEntry): ExecutiveToolRuntimeDescriptor {
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
        if (entry.server === SUBAGENT_SERVER && entry.tool.name === SUBAGENT_BATCH_TOOL) {
            return { batchBudgetUnit: "batch", concurrencySafe: true, exclusive: false, readOnly: true };
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

    private executionCallId(requestId: string, call: Pick<McpToolCallRequest, "server" | "tool" | "input">): string {
        return `${requestId}:${this.callKey(call)}:${this.previewText(call.input).slice(0, 48)}`;
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
