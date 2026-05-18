import type { SandboxConfig } from "../../config/index.ts";
import {
    CapabilityExecutionKind,
    SandboxMode,
    ToolApprovalMode,
    type CapabilityExecutionKind as CapabilityExecutionKindType,
} from "../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../events/index.ts";
import { Sandbox } from "../../components/index.ts";
import { Module } from "../di/decorators/index.ts";
import { SandboxQuotaTracker } from "./quota.ts";

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

@Module()
export class SandboxModule extends Sandbox {
    public constructor(private readonly config: SandboxConfig) {
        super();
    }

    public policy(): SandboxPolicy {
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

function resolveCapabilityApprovals(config: SandboxConfig): Record<CapabilityExecutionKindType, ToolApprovalMode> {
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

/**
 * 统一 capability 执行闸门：把「策略判定 + 事件发布 + 审批回调」收口到一个函数，
 * 避免每个执行点（plugin / shell-hook / MCP tool）各自复制一份审批流程，
 * 也避免新增执行点时漏发 Sandbox* 事件造成审计盲区。
 *
 * 调用方只需提供 descriptor（描述被门控对象的元数据，会原样写入事件 payload），
 * 可选 preDeny（前置拒因，例如「不在 catalog 内」「命令不在 allowlist」）和 approve（交互审批回调）。
 *
 * 返回 `{ allowed, reason }`：
 * - allowed=false 时 reason 是给调用方记录到错误对象的可读理由；
 * - 所有 deny / approval-requested / approval-denied 事件都已经在本函数内发布，
 *   调用方不需要再重复发布同样的 Sandbox* 事件。
 */
export interface CapabilityGateInput {
    policy: SandboxPolicy;
    kind: CapabilityExecutionKindType;
    events: EventSink;
    requestId?: string;
    /** 写入事件 payload 的描述字段（如 { server, tool } / { plugin, command } / { hook, command }）。 */
    descriptor: Record<string, unknown>;
    /** 前置拒因；非空时立即作为 SandboxToolDenied 上报并拒绝执行。 */
    preDeny?: { reason: string; message: string };
    /** 交互审批回调；缺省视作未批准。仅在策略要求审批时被调用。 */
    approve?: () => boolean | Promise<boolean>;
    /** 审批被拒时给调用方的可读理由，缺省 `${kind} was not approved`. */
    deniedMessage?: string;
    /** quota tracker：限频与 YOLO 冷却。 */
    quota?: SandboxQuotaTracker;
}

export async function gateCapabilityExecution(
    input: CapabilityGateInput,
): Promise<{ allowed: boolean; reason: string }> {
    const { policy, kind, events, requestId, descriptor } = input;
    if (input.preDeny) {
        events.publish(
            event(
                RuntimeEventType.SandboxToolDenied,
                { reason: input.preDeny.reason, kind, ...descriptor },
                requestId,
            ),
        );
        return { allowed: false, reason: input.preDeny.message };
    }
    const decision = decideCapabilityExecution(policy, kind);
    if (!decision.canExecute) {
        events.publish(
            event(
                RuntimeEventType.SandboxToolDenied,
                { reason: `${kind}-denied-by-policy`, kind, ...descriptor },
                requestId,
            ),
        );
        return { allowed: false, reason: decision.reason };
    }
    if (input.quota) {
        const yolo = policy.mode === SandboxMode.Yolo && decision.approval === ToolApprovalMode.Allow;
        const check = input.quota.checkBeforeAllow(kind, requestId, { yolo });
        if (!check.ok) {
            events.publish(
                event(
                    RuntimeEventType.SandboxToolDenied,
                    { reason: check.reason ?? "quota", kind, detail: check.detail, ...descriptor },
                    requestId,
                ),
            );
            return {
                allowed: false,
                reason: check.reason === "yolo-cooldown"
                    ? `${kind} blocked by sandbox YOLO cooldown (${check.detail ?? ""})`
                    : `${kind} blocked by sandbox quota (${check.detail ?? ""})`,
            };
        }
    }
    if (decision.requiresApproval) {
        events.publish(
            event(
                RuntimeEventType.SandboxToolApprovalRequested,
                { kind, ...descriptor },
                requestId,
            ),
        );
        const approved = await runApprover(input.approve);
        if (!approved) {
            events.publish(
                event(
                    RuntimeEventType.SandboxToolApprovalDenied,
                    { kind, ...descriptor },
                    requestId,
                ),
            );
            return { allowed: false, reason: input.deniedMessage ?? `${kind} was not approved` };
        }
    }
    if (input.quota) {
        const yolo = policy.mode === SandboxMode.Yolo && decision.approval === ToolApprovalMode.Allow;
        input.quota.recordAllow(kind, requestId, { yolo });
    }
    return { allowed: true, reason: decision.reason };
}

async function runApprover(approve?: () => boolean | Promise<boolean>): Promise<boolean> {
    if (!approve) return false;
    try {
        return await approve();
    } catch {
        // 审批 UI / 回调失败时按未批准处理，保持 capability gate 默认安全。
        return false;
    }
}
