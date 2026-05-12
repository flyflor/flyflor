import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { MemoryModule } from "../src/neural/memory/index.ts";
import { SQLiteMemoryStore, type PendingSkillOffer } from "../src/neural/memory/sqlite.ts";
import {
    detectExplicitSkillIntent,
    detectSkillCandidate,
    ProjectTriggerKind,
} from "../src/agent/project/index.ts";
import type { EpisodeRecord } from "../src/neural/memory/redis.ts";
import { MemorySourceKind } from "../src/protocol/contracts/index.ts";
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

function fakeEpisode(id: string, importance: number, sourceKind: string): EpisodeRecord {
    return {
        episodeId: id,
        userId: "u",
        text: "[user] do thing\n[assistant] done",
        concepts: [],
        embedding: [],
        importance,
        stability: importance,
        sourceKind,
        createdAt: Date.now(),
        metadata: {},
    };
}

describe("detectSkillCandidate (cluster heuristic)", () => {
    test("returns None when support too low", () => {
        const r = detectSkillCandidate({
            tools: ["fs.read"],
            episodes: [fakeEpisode("e1", 0.9, MemorySourceKind.McpAugmented)],
        });
        expect(r.kind).toBe(ProjectTriggerKind.None);
        expect(r.rationale).toBe("support-too-low");
    });

    test("returns None when mean importance below confidence threshold", () => {
        const eps = Array.from({ length: 5 }, (_, i) => fakeEpisode(`e${i}`, 0.4, MemorySourceKind.McpAugmented));
        const r = detectSkillCandidate({ tools: ["fs.read"], episodes: eps });
        expect(r.kind).toBe(ProjectTriggerKind.None);
        expect(r.rationale).toBe("confidence-too-low");
    });

    test("returns SkillCandidate when both thresholds met", () => {
        const eps = Array.from({ length: 5 }, (_, i) => fakeEpisode(`e${i}`, 0.85, MemorySourceKind.McpAugmented));
        const r = detectSkillCandidate({ tools: ["fs.read", "fs.write"], episodes: eps });
        expect(r.kind).toBe(ProjectTriggerKind.SkillCandidate);
        expect(r.relatedIds).toHaveLength(5);
        expect(r.score).toBeGreaterThan(0);
    });

    test("requires MCP-augmented evidence", () => {
        const eps = Array.from({ length: 6 }, (_, i) => fakeEpisode(`e${i}`, 0.9, MemorySourceKind.SessionTurn));
        const r = detectSkillCandidate({ tools: ["fs.read"], episodes: eps });
        expect(r.kind).toBe(ProjectTriggerKind.None);
        expect(r.rationale).toBe("mcp-evidence-too-thin");
    });
});

describe("detectExplicitSkillIntent", () => {
    test("fires only when skillPromotionIntent >= threshold", () => {
        expect(detectExplicitSkillIntent([]).kind).toBe(ProjectTriggerKind.None);
        expect(
            detectExplicitSkillIntent([
                {
                    action: "add",
                    target: "memory",
                    content: "x",
                    signals: { skillPromotionIntent: 0.5 },
                },
            ]).kind,
        ).toBe(ProjectTriggerKind.None);
        const r = detectExplicitSkillIntent([
            {
                action: "add",
                target: "memory",
                content: "x",
                signals: { skillPromotionIntent: 0.9 },
            },
        ]);
        expect(r.kind).toBe(ProjectTriggerKind.ExplicitSkill);
        expect(r.score).toBeCloseTo(0.9, 5);
    });
});

describe("pending_skill_offer DAO + consume lifecycle", () => {
    test("upsert / get / ttl decrement / delete", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        const offer: PendingSkillOffer = {
            userId: "u1",
            skillId: "skill-u1-x",
            name: "fs-pipeline",
            description: "Recurring read+write workflow.",
            summary: "## When to use\n- repeated read+write",
            support: 6,
            confidence: 0.82,
            mcpTools: ["fs.read", "fs.write"],
            relatedIds: ["e1", "e2"],
            proposedAt: new Date().toISOString(),
            ttlTurns: 2,
        };
        await store.upsertSkillOffer(offer);
        const got = await store.getSkillOffer("u1");
        expect(got?.name).toBe("fs-pipeline");
        expect(got?.mcpTools).toEqual(["fs.read", "fs.write"]);

        expect(await store.decrementSkillOfferTtl("u1")).toBe(1);
        expect(await store.decrementSkillOfferTtl("u1")).toBe(0);
        expect(await store.getSkillOffer("u1")).toBeUndefined();
    });

    test("consumeSkillOffer materialises SKILL.md + emits installed event", async () => {
        const config = await testConfig();
        const sink = new CapturingSink();
        const memory = new MemoryModule(config, sink, new StubModel());
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        await store.upsertSkillOffer({
            userId: "u2",
            skillId: "skill-u2-y",
            name: "search-summarise",
            description: "Web search + summarise pipeline.",
            summary: "## When to use\n- combine search and summarise.",
            support: 7,
            confidence: 0.83,
            mcpTools: ["web.search", "doc.summarise"],
            relatedIds: ["e1"],
            proposedAt: new Date().toISOString(),
            ttlTurns: 3,
        });

        const ok = await memory.consumeSkillOffer("u2");
        expect(ok).toBe(true);
        expect(await store.getSkillOffer("u2")).toBeUndefined();

        const dest = join(config.paths.skillDir, "search-summarise");
        const skillStat = await stat(join(dest, "SKILL.md"));
        expect(skillStat.isFile()).toBe(true);
        const skillBody = await readFile(join(dest, "SKILL.md"), "utf8");
        expect(skillBody).toContain("name: search-summarise");
        expect(skillBody).toContain("web.search");
        const manifest = JSON.parse(await readFile(join(dest, "skill.json"), "utf8"));
        expect(manifest.capabilities).toEqual(["web.search", "doc.summarise"]);
        expect(manifest.mcpServers).toEqual(["web", "doc"]);
        expect(sink.events.find((e) => e.type === RuntimeEventType.MemorySkillInstalled)).toBeDefined();
        expect(sink.events.find((e) => e.type === RuntimeEventType.MemorySkillOfferConsumed)).toBeDefined();

        const retro = await readFile(join(config.paths.projectMemoryDir, "RETROSPECTIVE.md"), "utf8");
        expect(retro).toContain("skill-promoted");
        expect(retro).toContain("search-summarise");
    });

    test("noteSkillOfferTurn: non-trigger decrements then expires", async () => {
        const config = await testConfig();
        const sink = new CapturingSink();
        const memory = new MemoryModule(config, sink, new StubModel());
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        await store.upsertSkillOffer({
            userId: "u3",
            skillId: "skill-u3-z",
            name: "noop",
            description: "noop",
            summary: "noop",
            support: 5,
            confidence: 0.75,
            mcpTools: ["a.b"],
            relatedIds: [],
            proposedAt: new Date().toISOString(),
            ttlTurns: 1,
        });
        await memory.noteSkillOfferTurn("u3", false);
        expect(sink.events.find((e) => e.type === RuntimeEventType.MemorySkillOfferExpired)).toBeDefined();
        expect(await store.getSkillOffer("u3")).toBeUndefined();
    });
});

async function testConfig() {
    const root = await mkdtemp(join(tmpdir(), "flyflor-skill-offer-"));
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
    await mkdir(paths.projectMemoryDir, { recursive: true });
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
