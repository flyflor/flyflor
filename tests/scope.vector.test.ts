import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { BrainStore } from "../src/cognitive/hippocampus/memory/brain/store.ts";
import { ScopeVectorComponent } from "../src/cognitive/hippocampus/scope/vector/component.ts";
import type { FlyflorPaths } from "../src/config/index.ts";
import type { CodenameRecord, ScopeRecord } from "../src/protocol/contracts/index.ts";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("ScopeVectorComponent", () => {
    test("owns a separate SQLite vector DB and recalls an explicit scope", async () => {
        const { brain, component, vectorDb } = await fixture();
        const now = Date.now();
        const scope = writeScope(brain, "scope-alpha", "Alpha Runtime", "socket vessel layer", now);
        await component.upsertScope({ scope, summary: "Socket wire and Apifox scenario planning", nowMs: now });

        const hits = await component.recall({ scopeId: scope.id, query: "socket Apifox", limit: 3, nowMs: now });
        expect(hits[0]?.scopeId).toBe(scope.id);
        expect(hits[0]?.summary).toContain("Socket wire");

        const brainTables = tables(join(pathsFromDb(vectorDb).configDir, "brain.db"));
        const vectorTables = tables(vectorDb);
        expect(brainTables).not.toContain("scope_vectors");
        expect(vectorTables).toContain("scope_vectors");
        brain.close();
    });

    test("resolves codename anchors into the promoted scope graph", async () => {
        const { brain, component } = await fixture();
        const now = Date.now();
        const scope = writeScope(brain, "scope-life", "Life Kernel", "scope graph indexing", now);
        const codename: CodenameRecord = {
            id: "cn-life",
            name: "flyflor-life",
            description: "Flyflor intelligent life kernel",
            createdAt: now,
            lastUsedAt: now,
            useCount: 8,
            scopeId: scope.id,
        };
        brain.upsertCodename(codename);
        await component.syncScopeFromBrain(scope.id);

        const hit = await component.resolveScope({ codenameId: codename.id, query: "intelligent life", nowMs: now });
        expect(hit?.scopeId).toBe(scope.id);
        expect(hit?.codenameId).toBe(codename.id);
        brain.close();
    });

    test("returns only the bounded hot subtree instead of all scopes", async () => {
        const { brain, component } = await fixture();
        const now = Date.now();
        const root = writeScope(brain, "scope-root", "Root Scope", "main graph", now);
        const related = writeScope(brain, "scope-related", "Related Scope", "nearby graph", now);
        const unrelated = writeScope(brain, "scope-unrelated", "Unrelated Scope", "cold graph", now);
        await component.upsertScope({ scope: root, summary: "Root scope summary", nowMs: now, relatedScopeIds: [related.id] });
        await component.upsertScope({ scope: related, summary: "Related scope summary", nowMs: now });
        await component.upsertScope({ scope: unrelated, summary: "Unrelated scope summary", nowMs: now });

        const hits = await component.recall({ scopeId: root.id, query: "graph", limit: 8, nowMs: now });
        expect(hits.map((hit) => hit.scopeId)).toContain(root.id);
        expect(hits.map((hit) => hit.scopeId)).toContain(related.id);
        expect(hits.map((hit) => hit.scopeId)).not.toContain(unrelated.id);
        expect(hits.length).toBeLessThan(3);
        brain.close();
    });

    test("rebuilds hot scope listing from the vector DB without full resident memory", async () => {
        const { brain, component, paths, vectorDb } = await fixture();
        const now = Date.now();
        const scope = writeScope(brain, "scope-restart", "Restart Scope", "persistent vector index", now);
        await component.upsertScope({ scope, nowMs: now });

        const restarted = new ScopeVectorComponent(paths, brain, { dbFile: vectorDb, vectorDimensions: 32 });
        await restarted.initialize();
        const hot = await restarted.listHotScopes(4);

        expect(restarted.getHotScopeIds()).toEqual([]);
        expect(hot[0]?.scopeId).toBe(scope.id);
        brain.close();
    });
});

async function fixture(): Promise<{
    brain: BrainStore;
    component: ScopeVectorComponent;
    paths: FlyflorPaths;
    vectorDb: string;
}> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-scope-vector-"));
    roots.push(root);
    const paths = makePaths(root);
    const brain = new BrainStore({ dbPath: join(paths.configDir, "brain.db") });
    await brain.open();
    const vectorDb = join(paths.storageDir, "scope-vector", "scope-vector.db");
    const component = new ScopeVectorComponent(paths, brain, { dbFile: vectorDb, vectorDimensions: 32 });
    await component.initialize();
    return { brain, component, paths, vectorDb };
}

function writeScope(brain: BrainStore, id: string, title: string, goal: string, now: number): ScopeRecord {
    return brain.upsertScope({
        id,
        title,
        goal,
        projectDir: join(tmpdir(), id),
        projectMemoryDir: join(tmpdir(), id, ".flyflor", "memory"),
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
        useCount: 1,
    });
}

function tables(dbPath: string): string[] {
    const db = new Database(dbPath);
    try {
        return db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    } finally {
        db.close();
    }
}

function pathsFromDb(dbPath: string): FlyflorPaths {
    return makePaths(dbPath.split("/storage/scope-vector/")[0]!);
}

function makePaths(root: string): FlyflorPaths {
    return {
        home: root,
        configDir: root,
        storageDir: join(root, "storage"),
        cacheDir: join(root, "cache"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        workspaceDir: join(root, "workspace"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        pluginDir: join(root, "plugins"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        templateDir: join(root, "templates"),
        mcpDir: join(root, "mcp"),
    };
}
