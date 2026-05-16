import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MemoryModule } from "../src/agent/index.ts";
import { fetchGhostList } from "../src/command/cli/handlers/ghost.list.handler.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import { GhostContextReason } from "../src/protocol/contracts/index.ts";
import { type EventSink } from "../src/protocol/events/index.ts";
import { FlyFlorTokens, type FlyFlor } from "../src/app.ts";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
});

class NoopSink implements EventSink {
    public publish(): void {}
}

function paths(root: string): FlyflorPaths {
    const home = join(root, "home");
    const project = join(root, "project");
    return {
        home,
        configDir: home,
        storageDir: join(home, "storage"),
        cacheDir: join(home, "cache"),
        workspaceDir: join(home, "workspace"),
        logDir: join(home, "logs"),
        memoryDir: join(home, "memory"),
        projectMemoryDir: join(home, "memory", "projects"),
        pluginDir: join(home, "plugins"),
        promptDir: join(home, "prompts"),
        skillDir: join(home, "skills"),
        templateDir: join(home, "templates"),
        mcpDir: join(home, "mcp"),
        projectDir: project,
        projectFlyflorDir: join(project, ".flyflor"),
        projectSkillDir: join(project, ".flyflor", "skills"),
        projectMcpDir: join(project, ".flyflor", "mcp"),
        projectPluginDir: join(project, ".flyflor", "plugins"),
    };
}

async function makeConfig(): Promise<FlyflorConfig> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-ghostpage-"));
    roots.push(root);
    const p = paths(root);
    const repoRoot = resolve(import.meta.dir, "..");
    await mkdir(p.home, { recursive: true });
    await symlink(join(repoRoot, "templates", "prompts"), p.promptDir, "dir");
    await symlink(join(repoRoot, "templates"), p.templateDir, "dir");
    return await loadConfigForPaths(p);
}

function fakeApp(config: FlyflorConfig): FlyFlor {
    return {
        resolve(token: unknown): unknown {
            if (token === FlyFlorTokens.Config) return config;
            throw new Error(`unknown token ${String(token)}`);
        },
    } as unknown as FlyFlor;
}

describe("LF-R4 fetchGhostList groups ghosts by codename", () => {
    test("returns present=false when brain.db missing", async () => {
        const config = await makeConfig();
        const data = await fetchGhostList(fakeApp(config), "user-1");
        expect(data.present).toBe(false);
        expect(data.total).toBe(0);
        expect(data.groups.length).toBe(0);
    });

    test("groups ghosts: codename buckets sorted; (no codename) last", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        await memory.warmup();
        try {
            memory.recordGhostFromReason({
                userId: "user-1",
                reason: GhostContextReason.ToolFailure,
                userFacing: { title: "tool fail A" },
                codenameId: "alpha",
                channelId: "stdio",
            });
            memory.recordGhostFromReason({
                userId: "user-1",
                reason: GhostContextReason.ProcessRestart,
                userFacing: { title: "restart B" },
                channelId: "stdio",
            });
            memory.recordGhostFromReason({
                userId: "user-1",
                reason: GhostContextReason.BlackboardCap,
                userFacing: { title: "cap C" },
                codenameId: "bravo",
                channelId: "stdio",
            });
            const data = await fetchGhostList(fakeApp(config), "user-1");
            expect(data.present).toBe(true);
            expect(data.total).toBe(3);
            const labels = data.groups.map((g) => g.label);
            expect(labels).toEqual(["alpha", "bravo", "(no codename)"]);
            const alpha = data.groups.find((g) => g.codenameId === "alpha");
            expect(alpha?.items[0]?.title).toBe("tool fail A");
        } finally {
            memory.dispose();
        }
    });
});
