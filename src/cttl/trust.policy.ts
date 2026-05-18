import {
    CttlCapabilitySource,
    CttlPermission,
    CttlToolScope,
    CttlTrustSurface,
    type CttlCapabilitySource as CttlCapabilitySourceType,
} from "../protocol/contracts/index.ts";
import type { CttlTrustContext, CttlTrustPolicyInput } from "./types.ts";

export class CttlTrustPolicy {
    public build(input: CttlTrustPolicyInput): CttlTrustContext {
        const allowedScopes = new Set<CttlToolScope>();
        this.addBaseScopes(allowedScopes, input);
        if (input.projectScoped) {
            allowedScopes.add(CttlToolScope.Project);
        }
        if (input.debug) {
            allowedScopes.add(CttlToolScope.Debug);
        }

        return {
            allowedScopes,
            allowedSources: new Set(input.allowedSources ?? this.defaultSources(input.surface)),
            deniedTools: input.deniedTools ? new Set(input.deniedTools) : undefined,
            maxPermission: input.maxPermission ?? this.defaultPermission(input),
            unavailableTools: input.unavailableTools ? new Set(input.unavailableTools) : undefined,
        };
    }

    private addBaseScopes(scopes: Set<CttlToolScope>, input: CttlTrustPolicyInput): void {
        scopes.add(CttlToolScope.Core);
        if (input.surface !== CttlTrustSurface.Background) {
            scopes.add(CttlToolScope.Chat);
        }
        if (input.surface === CttlTrustSurface.Channel) {
            scopes.add(CttlToolScope.Channel);
            return;
        }
        if (input.surface === CttlTrustSurface.Background) {
            scopes.add(CttlToolScope.Background);
            return;
        }
        scopes.add(CttlToolScope.Local);
    }

    private defaultPermission(input: CttlTrustPolicyInput): CttlPermission {
        if (input.debug && input.surface === CttlTrustSurface.Local) {
            return CttlPermission.Dangerous;
        }
        if (input.surface === CttlTrustSurface.Channel) {
            return CttlPermission.Message;
        }
        if (input.surface === CttlTrustSurface.Background) {
            return CttlPermission.Network;
        }
        return CttlPermission.Write;
    }

    private defaultSources(surface: CttlTrustPolicyInput["surface"]): readonly CttlCapabilitySourceType[] {
        if (surface === CttlTrustSurface.Channel) {
            return [CttlCapabilitySource.Core, CttlCapabilitySource.Channel, CttlCapabilitySource.Mcp];
        }
        if (surface === CttlTrustSurface.Background) {
            return [CttlCapabilitySource.Core, CttlCapabilitySource.Mcp, CttlCapabilitySource.Plugin];
        }
        return [
            CttlCapabilitySource.Core,
            CttlCapabilitySource.Mcp,
            CttlCapabilitySource.Plugin,
            CttlCapabilitySource.Skill,
            CttlCapabilitySource.User,
            CttlCapabilitySource.Subagent,
        ];
    }
}
