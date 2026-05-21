import {
    CapabilitySource,
    ToolPermission,
    ToolScope,
    TrustSurface,
    type CapabilitySource as CapabilitySourceType,
} from "../protocol/contracts/index.ts";
import type { TrustContext, TrustPolicyInput } from "./types.ts";

export class TrustPolicy {
    public build(input: TrustPolicyInput): TrustContext {
        const allowedScopes = new Set<ToolScope>();
        this.addBaseScopes(allowedScopes, input);
        if (input.projectScoped) {
            allowedScopes.add(ToolScope.Workspace);
        }
        if (input.debug) {
            allowedScopes.add(ToolScope.Debug);
        }

        return {
            allowedScopes,
            allowedSources: new Set(input.allowedSources ?? this.defaultSources(input.surface)),
            deniedTools: input.deniedTools ? new Set(input.deniedTools) : undefined,
            maxPermission: input.maxPermission ?? this.defaultPermission(input),
            unavailableTools: input.unavailableTools ? new Set(input.unavailableTools) : undefined,
        };
    }

    private addBaseScopes(scopes: Set<ToolScope>, input: TrustPolicyInput): void {
        scopes.add(ToolScope.Core);
        if (input.surface !== TrustSurface.Background) {
            scopes.add(ToolScope.Chat);
        }
        if (input.surface === TrustSurface.Channel) {
            scopes.add(ToolScope.Channel);
            return;
        }
        if (input.surface === TrustSurface.Background) {
            scopes.add(ToolScope.Background);
            return;
        }
        scopes.add(ToolScope.Local);
    }

    private defaultPermission(input: TrustPolicyInput): ToolPermission {
        if (input.debug && input.surface === TrustSurface.Local) {
            return ToolPermission.Dangerous;
        }
        if (input.surface === TrustSurface.Channel) {
            return ToolPermission.Message;
        }
        if (input.surface === TrustSurface.Background) {
            return ToolPermission.Network;
        }
        return ToolPermission.Write;
    }

    private defaultSources(surface: TrustPolicyInput["surface"]): readonly CapabilitySourceType[] {
        if (surface === TrustSurface.Channel) {
            return [CapabilitySource.Core, CapabilitySource.Channel, CapabilitySource.Mcp];
        }
        if (surface === TrustSurface.Background) {
            return [CapabilitySource.Core, CapabilitySource.Mcp, CapabilitySource.Plugin];
        }
        return [
            CapabilitySource.Core,
            CapabilitySource.Mcp,
            CapabilitySource.Plugin,
            CapabilitySource.Skill,
            CapabilitySource.User,
            CapabilitySource.Subagent,
        ];
    }
}
