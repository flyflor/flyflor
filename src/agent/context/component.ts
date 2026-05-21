import { basename, join, resolve } from "node:path";
import { ContextComponent } from "../../components/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import type { GatewayMessage } from "../../protocol/contracts/index.ts";
import type { RuntimeContext, RuntimeScope } from "../../protocol/contracts/index.ts";

export interface ContextScopeStorePaths extends FlyflorPaths {
    projectDir: string;
    projectFlyflorDir: string;
    projectMemoryDir: string;
    projectSkillDir: string;
    projectMcpDir: string;
    projectPluginDir: string;
}

export interface ExplicitScopeSeed {
    id: string;
    projectDir: string;
    projectMemoryDir: string;
    title: string;
}

/**
 * Structured context scope assembly for scope/fork/capability boundaries.
 * This layer is intentionally parallel to neural: it normalizes explicit
 * RuntimeContext fields for runtime, memory, skill, mcp, plugin, and gem
 * assembly, but never reads natural language intent and never stores continuity owners.
 */
export class ContextScopeComponent extends ContextComponent {
    public constructor(private readonly paths: FlyflorPaths) {
        super();
    }

    public scopeStorePaths(scope: RuntimeScope | undefined): FlyflorPaths {
        if (!scope) return this.paths;
        return {
            ...this.paths,
            projectDir: scope.projectDir,
            projectFlyflorDir: join(scope.projectDir, ".flyflor"),
            projectMemoryDir: scope.projectMemoryDir,
            projectSkillDir: join(scope.projectDir, ".flyflor", "skills"),
            projectMcpDir: join(scope.projectDir, ".flyflor", "mcp"),
            projectPluginDir: join(scope.projectDir, ".flyflor", "plugins"),
        } satisfies ContextScopeStorePaths;
    }

    public scopeConstraintId(input: {
        codenameId?: string;
        context: RuntimeContext;
    }): string | null {
        return input.context.activeScope?.id ?? null;
    }

    public explicitScopeSeed(rawPath: string): ExplicitScopeSeed {
        const projectDir = resolve(rawPath);
        return {
            id: ContextScopeComponent.deriveExplicitScopeId(projectDir),
            projectDir,
            projectMemoryDir: join(projectDir, ".flyflor", "memory"),
            title: basename(projectDir) || "scope",
        };
    }

    private static deriveExplicitScopeId(projectDir: string): string {
        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(projectDir);
        return `scope-${hasher.digest("hex").slice(0, 16)}`;
    }
}

export function continuityOwnerKey(message: GatewayMessage, context?: RuntimeContext, codenameId?: string): string {
    const scopeId = context?.activeScope?.id;
    if (scopeId) return `scope:${scopeId}`;
    if (context?.contextForkId) return `fork:${context.contextForkId}`;
    if (codenameId) return `codename:${codenameId}`;
    return `turn:${message.id}`;
}

export function sourceKeyForMessage(message: GatewayMessage, context?: RuntimeContext): string {
    return message.source?.messageId ?? context?.requestId ?? message.id;
}

export function sourceSurfaceForMessage(message: GatewayMessage): string {
    return message.route.channel;
}
