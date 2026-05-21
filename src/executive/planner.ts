import {
    ToolHiddenReason,
    ToolPermission,
    type ToolPermission as ToolPermissionType,
} from "../protocol/contracts/index.ts";
import type {
    HiddenToolPlanEntry,
    RegisteredTool,
    ToolDescriptor,
    ToolPlanEntry,
    ToolPlan,
    ToolPlanDiagnostic,
    TrustContext,
} from "./types.ts";

const PERMISSION_RANK: Readonly<Record<ToolPermissionType, number>> = {
    [ToolPermission.None]: 0,
    [ToolPermission.Read]: 1,
    [ToolPermission.Write]: 2,
    [ToolPermission.Network]: 3,
    [ToolPermission.Message]: 4,
    [ToolPermission.Execute]: 5,
    [ToolPermission.Computer]: 6,
    [ToolPermission.Dangerous]: 7,
};

export class ToolPlanner {
    public build(tools: readonly RegisteredTool[], trust: TrustContext = {}): ToolPlan {
        const visible: ToolPlanEntry[] = [];
        const hidden: HiddenToolPlanEntry[] = [];
        const seen = new Set<string>();
        for (const tool of [...tools].sort((left, right) => left.descriptor.name.localeCompare(right.descriptor.name))) {
            const descriptor = tool.descriptor;
            const diagnostics = this.evaluateDescriptor(descriptor, trust, seen);
            seen.add(descriptor.name);
            if (diagnostics.length > 0) {
                hidden.push({ descriptor, diagnostics });
                continue;
            }
            visible.push({ descriptor });
        }
        return { visible, hidden };
    }

    private evaluateDescriptor(
        descriptor: ToolDescriptor,
        trust: TrustContext,
        seen: ReadonlySet<string>,
    ): ToolPlanDiagnostic[] {
        const diagnostics: ToolPlanDiagnostic[] = [];
        if (seen.has(descriptor.name)) {
            diagnostics.push({
                reason: ToolHiddenReason.Duplicate,
                message: `Tool ${descriptor.name} is registered more than once.`,
            });
        }
        if (trust.allowedSources && !trust.allowedSources.has(descriptor.source)) {
            diagnostics.push({
                reason: ToolHiddenReason.SourceDisabled,
                message: `Tool source ${descriptor.source} is not enabled in this context.`,
            });
        }
        if (trust.allowedScopes && !descriptor.scope.some((scope) => trust.allowedScopes?.has(scope))) {
            diagnostics.push({
                reason: ToolHiddenReason.ScopeMismatch,
                message: `Tool ${descriptor.name} has no scope enabled in this context.`,
            });
        }
        if (trust.maxPermission && !isPermissionAllowed(descriptor.permission, trust.maxPermission)) {
            diagnostics.push({
                reason: ToolHiddenReason.PermissionCap,
                message: `Tool ${descriptor.name} requires ${descriptor.permission}, above ${trust.maxPermission}.`,
            });
        }
        if (trust.deniedTools?.has(descriptor.name)) {
            diagnostics.push({
                reason: ToolHiddenReason.TrustDenied,
                message: `Tool ${descriptor.name} is denied by trust policy.`,
            });
        }
        if (trust.unavailableTools?.has(descriptor.name)) {
            diagnostics.push({
                reason: ToolHiddenReason.Availability,
                message: `Tool ${descriptor.name} is unavailable in this runtime context.`,
            });
        }
        return diagnostics;
    }
}

export function isPermissionAllowed(required: ToolPermissionType, cap: ToolPermissionType): boolean {
    return PERMISSION_RANK[required] <= PERMISSION_RANK[cap];
}
