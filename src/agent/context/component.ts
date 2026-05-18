import { basename, join, resolve } from "node:path";
import { ContextComponent } from "../../components/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import type { GatewayMessage, RuntimeContext, RuntimeProjectScope } from "../../protocol/contracts/index.ts";

export interface ContextProjectStorePaths extends FlyflorPaths {
    projectDir: string;
    projectFlyflorDir: string;
    projectMemoryDir: string;
    projectSkillDir: string;
    projectMcpDir: string;
    projectPluginDir: string;
}

export interface ExplicitProjectSeed {
    id: string;
    projectDir: string;
    projectMemoryDir: string;
    title: string;
}

/**
 * Structured context scope assembly for project/fork/capability boundaries.
 * This layer is intentionally parallel to neural: it normalizes explicit
 * RuntimeContext fields for runtime, memory, skill, mcp, plugin, and gem
 * assembly, but never reads natural language intent and never stores session.
 */
export class ContextScopeComponent extends ContextComponent {
    public constructor(private readonly paths: FlyflorPaths) {
        super();
    }

    public projectStorePaths(scope: RuntimeProjectScope | undefined): FlyflorPaths {
        if (!scope) return this.paths;
        return {
            ...this.paths,
            projectDir: scope.projectDir,
            projectFlyflorDir: join(scope.projectDir, ".flyflor"),
            projectMemoryDir: scope.projectMemoryDir,
            projectSkillDir: join(scope.projectDir, ".flyflor", "skills"),
            projectMcpDir: join(scope.projectDir, ".flyflor", "mcp"),
            projectPluginDir: join(scope.projectDir, ".flyflor", "plugins"),
        } satisfies ContextProjectStorePaths;
    }

    public projectConstraintId(input: {
        codenameId?: string;
        fallbackProjectId: string;
        inboxProjectId: string;
        message: GatewayMessage;
        projectIntent: boolean;
        context: RuntimeContext;
    }): string {
        if (input.context.activeProject) return input.context.activeProject.id;
        if (input.projectIntent) return input.fallbackProjectId;
        if (input.codenameId) return `${input.inboxProjectId}:cn-${input.codenameId}`;
        return input.inboxProjectId;
    }

    public explicitProjectSeed(userId: string, rawPath: string): ExplicitProjectSeed {
        const projectDir = resolve(rawPath);
        return {
            id: ContextScopeComponent.deriveExplicitProjectId(userId, projectDir),
            projectDir,
            projectMemoryDir: join(projectDir, ".flyflor", "memory"),
            title: basename(projectDir) || "project",
        };
    }

    private static deriveExplicitProjectId(userId: string, projectDir: string): string {
        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(`${userId}:${projectDir}`);
        return `project-${hasher.digest("hex").slice(0, 16)}`;
    }
}
