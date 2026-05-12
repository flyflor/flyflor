import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { MemoryModule } from "../src/neural/memory/index.ts";
import { SQLiteMemoryStore } from "../src/neural/memory/sqlite.ts";
import type { ModelClient, ModelMessage, RuntimeEvent } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

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
    readonly events: RuntimeEvent[] = [];
    publish(e: RuntimeEvent): void {
        this.events.push(e);
    }
}
class StubModel implements ModelClient {
    async generate(_messages: ModelMessage[]): Promise<string> {
        return "{}";
    }
}

describe("pending_project_offer DAO + nudge lifecycle", () => {
    test("upsert / get / ttl decrement / delete", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        await store.upsertProjectOffer({
            userId: "u1",
            projectId: "p1",
            title: "Refactor router",
            goal: "Repeated discussions about router refactor",
            triggerKind: "cluster-candidate",
            evidenceScore: 0.72,
            relatedIds: ["e1", "e2", "e3"],
            proposedAt: new Date().toISOString(),
            ttlTurns: 2,
        });
        const got = await store.getProjectOffer("u1");
        expect(got).toBeDefined();
        expect(got?.title).toBe("Refactor router");
        expect(got?.relatedIds).toEqual(["e1", "e2", "e3"]);

        const r1 = await store.decrementProjectOfferTtl("u1");
        expect(r1).toBe(1);
        const r2 = await store.decrementProjectOfferTtl("u1");
        expect(r2).toBe(0);
        const after = await store.getProjectOffer("u1");
        expect(after).toBeUndefined();
    });

    test("noteProjectOfferTurn: explicit trigger consumes; non-trigger decrements then expires", async () => {
        const config = await testConfig();
        const sink = new CapturingSink();
        const memory = new MemoryModule(config, sink, new StubModel());
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        await store.upsertProjectOffer({
            userId: "u2",
            projectId: "p2",
            title: "Auth refactor",
            goal: "test",
            triggerKind: "cluster-candidate",
            evidenceScore: 0.6,
            relatedIds: [],
            proposedAt: new Date().toISOString(),
            ttlTurns: 1,
        });

        await memory.noteProjectOfferTurn("u2", false);
        expect(sink.events.find((e) => e.type === RuntimeEventType.MemoryProjectOfferExpired)).toBeDefined();
        expect(await store.getProjectOffer("u2")).toBeUndefined();

        await store.upsertProjectOffer({
            userId: "u3",
            projectId: "p3",
            title: "Logger overhaul",
            goal: "test",
            triggerKind: "cluster-candidate",
            evidenceScore: 0.8,
            relatedIds: [],
            proposedAt: new Date().toISOString(),
            ttlTurns: 3,
        });
        await memory.noteProjectOfferTurn("u3", true);
        expect(sink.events.find((e) => e.type === RuntimeEventType.MemoryProjectOfferConsumed)).toBeDefined();
        expect(await store.getProjectOffer("u3")).toBeUndefined();
    });
});

async function testConfig() {
    const root = await mkdtemp(join(tmpdir(), "flyflor-project-offer-"));
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
    await mkdir(join(paths.templateDir, "memory"), { recursive: true });
    const promptSrc = join(import.meta.dir, "..", "templates", "prompts");
    const memSrc = join(import.meta.dir, "..", "templates", "memory");
    for (const [src, dst] of [
        [promptSrc, paths.promptDir],
        [memSrc, join(paths.templateDir, "memory")],
    ]) {
        const entries = await readdir(src!, { withFileTypes: true });
        await Promise.all(
            entries.filter((e) => e.isFile()).map((e) => copyFile(join(src!, e.name), join(dst!, e.name))),
        );
    }
    return loadConfigForPaths(paths);
}
