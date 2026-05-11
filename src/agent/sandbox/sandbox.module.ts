import type { SandboxConfig } from "../../config/index.ts";
import {
    ArchitectureLayer,
    CapabilityExecutionKind,
    ComponentKind,
    SandboxMode,
    ToolApprovalMode,
    type CapabilityExecutionKind as CapabilityExecutionKindType,
} from "../../protocol/contracts/index.ts";
import { Sandbox } from "../components.ts";
import { Module, Provide } from "../di/decorators/index.ts";

export interface SandboxPolicy {
    mode: SandboxMode;
    approvals: Record<CapabilityExecutionKindType, ToolApprovalMode>;
    mcpToolApproval: ToolApprovalMode;
    pluginApproval: ToolApprovalMode;
    shellHookApproval: ToolApprovalMode;
    canExecuteTools: boolean;
    requiresApproval: boolean;
    summary: string;
}

export interface CapabilityExecutionDecision {
    approval: ToolApprovalMode;
    canExecute: boolean;
    kind: CapabilityExecutionKindType;
    reason: string;
    requiresApproval: boolean;
}

@Module({ name: "sandbox", tags: ["flyflor", "boundary"] })
@Provide({ kind: ComponentKind.Sandbox, layer: ArchitectureLayer.Control, name: "sandbox", provider: true })
export class SandboxModule extends Sandbox {
    constructor(private readonly config: SandboxConfig) {
        super();
    }

    policy(): SandboxPolicy {
        const approvals = resolveCapabilityApprovals(this.config);
        const mcp = decideCapabilityExecution(
            {
                mode: this.config.mode,
                approvals,
                mcpToolApproval: approvals[CapabilityExecutionKind.McpTool],
                pluginApproval: approvals[CapabilityExecutionKind.Plugin],
                shellHookApproval: approvals[CapabilityExecutionKind.ShellHook],
                canExecuteTools: false,
                requiresApproval: true,
                summary: "",
            },
            CapabilityExecutionKind.McpTool,
        );
        return {
            mode: this.config.mode,
            approvals,
            mcpToolApproval: approvals[CapabilityExecutionKind.McpTool],
            pluginApproval: approvals[CapabilityExecutionKind.Plugin],
            shellHookApproval: approvals[CapabilityExecutionKind.ShellHook],
            canExecuteTools: mcp.canExecute,
            requiresApproval: mcp.requiresApproval,
            summary: renderSandboxPolicySummary(this.config.mode, approvals),
        };
    }
}

export function createSandboxPolicy(config: SandboxConfig): SandboxPolicy {
    return new SandboxModule(config).policy();
}

export function decideCapabilityExecution(
    policy: SandboxPolicy,
    kind: CapabilityExecutionKindType,
): CapabilityExecutionDecision {
    const approval = policy.approvals[kind] ?? ToolApprovalMode.Deny;
    if (approval === ToolApprovalMode.Allow) {
        return {
            approval,
            canExecute: true,
            kind,
            reason: `${kind} execution is allowed without interactive approval.`,
            requiresApproval: false,
        };
    }
    if (approval === ToolApprovalMode.Ask) {
        return {
            approval,
            canExecute: true,
            kind,
            reason: `${kind} execution requires interactive approval.`,
            requiresApproval: true,
        };
    }
    return {
        approval,
        canExecute: false,
        kind,
        reason: `${kind} execution is denied by sandbox policy.`,
        requiresApproval: true,
    };
}

function resolveCapabilityApprovals(
    config: SandboxConfig,
): Record<CapabilityExecutionKindType, ToolApprovalMode> {
    return {
        [CapabilityExecutionKind.McpTool]: config.mcpToolApproval ?? defaultApproval(config.mode),
        [CapabilityExecutionKind.Plugin]: config.pluginApproval ?? defaultApproval(config.mode),
        [CapabilityExecutionKind.ShellHook]: config.shellHookApproval ?? defaultApproval(config.mode),
    };
}

function defaultApproval(mode: SandboxMode): ToolApprovalMode {
    return mode === SandboxMode.Yolo ? ToolApprovalMode.Allow : ToolApprovalMode.Deny;
}

function renderSandboxPolicySummary(
    mode: SandboxMode,
    approvals: Record<CapabilityExecutionKindType, ToolApprovalMode>,
): string {
    return [
        `Sandbox mode: ${mode}.`,
        `MCP tools: ${approvals[CapabilityExecutionKind.McpTool]}.`,
        `Shell hooks: ${approvals[CapabilityExecutionKind.ShellHook]}.`,
        `Plugins: ${approvals[CapabilityExecutionKind.Plugin]}.`,
    ].join(" ");
}
