import {
    CttlHiddenReason,
    CttlPermission,
    type CttlPermission as CttlPermissionType,
} from "../protocol/contracts/index.ts";
import type {
    CttlHiddenToolPlanEntry,
    CttlRegisteredTool,
    CttlToolDescriptor,
    CttlToolPlanEntry,
    CttlToolPlan,
    CttlToolPlanDiagnostic,
    CttlTrustContext,
} from "./types.ts";

const PERMISSION_RANK: Readonly<Record<CttlPermissionType, number>> = {
    [CttlPermission.None]: 0,
    [CttlPermission.Read]: 1,
    [CttlPermission.Write]: 2,
    [CttlPermission.Network]: 3,
    [CttlPermission.Message]: 4,
    [CttlPermission.Execute]: 5,
    [CttlPermission.Computer]: 6,
    [CttlPermission.Dangerous]: 7,
};

export class CttlToolPlanner {
    public build(tools: readonly CttlRegisteredTool[], trust: CttlTrustContext = {}): CttlToolPlan {
        const visible: CttlToolPlanEntry[] = [];
        const hidden: CttlHiddenToolPlanEntry[] = [];
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
        descriptor: CttlToolDescriptor,
        trust: CttlTrustContext,
        seen: ReadonlySet<string>,
    ): CttlToolPlanDiagnostic[] {
        const diagnostics: CttlToolPlanDiagnostic[] = [];
        if (seen.has(descriptor.name)) {
            diagnostics.push({
                reason: CttlHiddenReason.Duplicate,
                message: `Tool ${descriptor.name} is registered more than once.`,
            });
        }
        if (trust.allowedSources && !trust.allowedSources.has(descriptor.source)) {
            diagnostics.push({
                reason: CttlHiddenReason.SourceDisabled,
                message: `Tool source ${descriptor.source} is not enabled in this context.`,
            });
        }
        if (trust.allowedScopes && !descriptor.scope.some((scope) => trust.allowedScopes?.has(scope))) {
            diagnostics.push({
                reason: CttlHiddenReason.ScopeMismatch,
                message: `Tool ${descriptor.name} has no scope enabled in this context.`,
            });
        }
        if (trust.maxPermission && !isPermissionAllowed(descriptor.permission, trust.maxPermission)) {
            diagnostics.push({
                reason: CttlHiddenReason.PermissionCap,
                message: `Tool ${descriptor.name} requires ${descriptor.permission}, above ${trust.maxPermission}.`,
            });
        }
        if (trust.deniedTools?.has(descriptor.name)) {
            diagnostics.push({
                reason: CttlHiddenReason.TrustDenied,
                message: `Tool ${descriptor.name} is denied by trust policy.`,
            });
        }
        if (trust.unavailableTools?.has(descriptor.name)) {
            diagnostics.push({
                reason: CttlHiddenReason.Availability,
                message: `Tool ${descriptor.name} is unavailable in this runtime context.`,
            });
        }
        return diagnostics;
    }
}

export function isPermissionAllowed(required: CttlPermissionType, cap: CttlPermissionType): boolean {
    return PERMISSION_RANK[required] <= PERMISSION_RANK[cap];
}
