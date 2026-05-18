import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import { CrystalMemoryBackend, ModelRole, type ModelClient, type ModelMessage } from "../src/protocol/contracts/index.ts";
import { type EventSink } from "../src/events/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";

beforeAll(async () => {
    await loadPromptTemplates({ promptDir: join(import.meta.dir, "..", "templates", "prompts") } as never);
});

const tempRoots: string[] = [];
afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (root) await rm(root, { recursive: true, force: true });
    }
});

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];
    public publish(e: RuntimeEvent): void {
        this.events.push(e);
    }
}

class StubModel implements ModelClient {
    public async generate(_messages: ModelMessage[]): Promise<string> {
        void ModelRole.User;
        return "{}";
    }
}

describe("MemoryModule background scheduler wiring", () => {
    test("scheduler is null when crystal graph is disabled by default", async () => {
        const config = await testConfig();
        const memory = new MemoryModule(config, new CapturingSink(), new StubModel());
        // 默认本地 working memory 可写入，但长期晶体图未启用时不启动后台聚合。
        await memory.warmup();
        memory.dispose();
        expect((memory as unknown as { scheduler: unknown }).scheduler).toBeNull();
    });

    test("scheduler is null without a model even if working memory and crystal graph would qualify", async () => {
        const config = await testConfig();
        config.memory.crystal.enabled = true;
        config.memory.crystal.backend = CrystalMemoryBackend.Local;
        const memory = new MemoryModule(config, new CapturingSink());
        expect((memory as unknown as { scheduler: unknown }).scheduler).toBeNull();
    });

    test("scheduler is instantiated when working memory + crystal graph + model all present", async () => {
        const config = await testConfig();
        config.memory.crystal.enabled = true;
        config.memory.crystal.backend = CrystalMemoryBackend.Local;
        const memory = new MemoryModule(config, new CapturingSink(), new StubModel());
        const scheduler = (memory as unknown as {
            scheduler: { activeUsers(): number; snapshot(): { brainArchiveEnabled: boolean; hotMemoryCompressionEnabled: boolean } } | null;
        }).scheduler;
        expect(scheduler).not.toBeNull();
        expect(scheduler?.activeUsers()).toBe(0);
        expect(scheduler?.snapshot().brainArchiveEnabled).toBe(true);
        expect(scheduler?.snapshot().hotMemoryCompressionEnabled).toBe(true);
        // dispose 必须可以多次调用
        memory.dispose();
        memory.dispose();
    });

    test("scheduler is instantiated for the local crystal backend without SurrealDB", async () => {
        const config = await testConfig();
        config.memory.crystal.enabled = true;
        config.memory.crystal.backend = CrystalMemoryBackend.Local;
        const memory = new MemoryModule(config, new CapturingSink(), new StubModel());
        const scheduler = (memory as unknown as {
            scheduler: { activeUsers(): number } | null;
        }).scheduler;
        expect(scheduler).not.toBeNull();
        expect(scheduler?.activeUsers()).toBe(0);
        memory.dispose();
    });
});

async function testConfig() {
    const root = await mkdtemp(join(tmpdir(), "flyflor-mem-wire-"));
    tempRoots.push(root);
    const paths: FlyflorPaths = {
        home: join(root, "home"),
        configDir: join(root, "home"),
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        workspaceDir: join(root, "home", "workspace"),
        logDir: join(root, "home", "logs"),
        memoryDir: join(root, "data", "memory"),
        pluginDir: join(root, "home", "plugins"),
        promptDir: join(root, "home", "prompts"),
        skillDir: join(root, "home", "skills"),
        templateDir: join(root, "home", "templates"),
        mcpDir: join(root, "home", "mcp"),
    };
    await mkdir(paths.promptDir, { recursive: true });
    const src = join(import.meta.dir, "..", "templates", "prompts");
    const entries = await readdir(src, { withFileTypes: true });
    await Promise.all(
        entries.filter((e) => e.isFile()).map((e) => copyFile(join(src, e.name), join(paths.promptDir, e.name))),
    );
    return loadConfigForPaths(paths);
}
