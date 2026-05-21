import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MemoryModule, RuntimeModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import { ContinuationContextReason, type ModelClient } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";

const tempRoots: string[] = [];
const cleanup = async () => {
    await Promise.all(tempRoots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
};

class CapturingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public publish(evt: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(evt);
    }
}

async function tempRoot(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "flyflor-restart-"));
    tempRoots.push(d);
    return d;
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
    const root = await tempRoot();
    const p = paths(root);
    const repoRoot = resolve(import.meta.dir, "..");
    await mkdir(p.home, { recursive: true });
    await symlink(join(repoRoot, "templates", "prompts"), p.promptDir, "dir");
    await symlink(join(repoRoot, "templates"), p.templateDir, "dir");
    return await loadConfigForPaths(p);
}

class NoopModel implements ModelClient {
    public readonly id = "noop";
    public async generate(): Promise<string> {
        return "ok";
    }
}

describe("LF-R4 process-restart continuation recovery", () => {
    test("warmup picks up leftover inflight sentinel and writes a process-restart continuation", async () => {
        try {
            const config = await makeConfig();
            // Seed a leftover inflight sentinel as if a previous process died mid-request.
            const inflightDir = join(config.paths.storageDir, "inflight");
            await mkdir(inflightDir, { recursive: true });
            await writeFile(
                join(inflightDir, "req-orphan.json"),
                JSON.stringify({
                    requestId: "req-orphan",
                    userId: "user-1",
                    channelId: "stdio",
                    originalUserMessage: "deploy the staging cluster please",
                    startedAtMs: Date.now() - 1000,
                }),
                "utf8",
            );

            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            const runtime = new RuntimeModule(config, new NoopModel(), events, undefined, memory);
            try {
                await runtime.warmup();
                const continuations = memory.listActiveContinuations("user-1");
                expect(continuations.length).toBe(1);
                const c = continuations[0]!.content as {
                    reason: string;
                    userFacing: { title: string; contextHint?: string };
                };
                expect(c.reason).toBe(ContinuationContextReason.ProcessRestart);
                expect(c.userFacing.title).toBe("Interrupted by process restart");
                expect(c.userFacing.contextHint).toContain("deploy the staging cluster");
                const recorded = events.events.find(
                    (e) =>
                        e.type === RuntimeEventType.MemoryContinuationRecorded &&
                        e.payload?.reason === ContinuationContextReason.ProcessRestart,
                );
                expect(recorded).toBeDefined();
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });
});
