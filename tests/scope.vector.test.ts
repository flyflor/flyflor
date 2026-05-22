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
    test("defaults to scope-local scope.db instead of brain.db", async () => {
        const { brain, paths } = await fixture({ explicitVectorDb: false });
        const now = Date.now();
        const projectDir = join(paths.workspaceDir, "alpha-project");
        const scope = writeScope(brain, "scope-local-alpha", "Local Alpha", "scope-local vector plane", now, projectDir);
        const component = new ScopeVectorComponent(paths, brain, { vectorDimensions: 32 });
        await component.initialize();
        await component.upsertScope({ scope, summary: "Scope-local memory tree root", nowMs: now });

        const scopeDb = join(projectDir, ".flyflor", "scope.db");
        expect(tables(scopeDb)).toContain("scope_vectors");
        expect(tables(scopeDb)).toContain("scope_hot_memory");
        expect(tables(scopeDb)).toContain("scope_tree_nodes");
        expect(tables(join(paths.configDir, "brain.db"))).not.toContain("scope_vectors");

        const restarted = new ScopeVectorComponent(paths, brain, { vectorDimensions: 32 });
        const hot = await restarted.listHotScopes(4);
        expect(hot[0]?.scopeId).toBe(scope.id);
        restarted.dispose();
        component.dispose();
        brain.close();
    });

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

    test("records turn hot memory inside scope.db and renders it during recall", async () => {
        const { brain, component } = await fixture();
        const now = Date.now();
        const scope = writeScope(brain, "scope-hot", "Hot Scope", "ASK closure and long loop", now);
        await component.noteTurn({
            context: {
                requestId: "req-hot",
                now: new Date(now).toISOString(),
                activeScope: {
                    id: scope.id,
                    title: scope.title,
                    projectDir: scope.projectDir,
                    projectMemoryDir: scope.projectMemoryDir,
                },
            },
            messageText: "Implement scope db hot memory",
            replyText: "Scope hot memory writes project memory into scope.db",
            activeScope: {
                id: scope.id,
                title: scope.title,
                projectDir: scope.projectDir,
                projectMemoryDir: scope.projectMemoryDir,
            },
            nowMs: now,
        });

        const hits = await component.recall({ scopeId: scope.id, query: "hot memory", limit: 2, nowMs: now });
        expect(hits[0]?.summary).toContain("Scope hot memory:");
        expect(hits[0]?.summary).toContain("scope.db");
        brain.close();
    });

    test("uses scope association rows as recall evidence without writing ledger history", async () => {
        const { brain, component, vectorDb } = await fixture();
        const now = Date.now();
        const scope = writeScope(brain, "scope-association", "Association Scope", "project memory relation index", now);
        await component.upsertScope({ scope, summary: "Association scope root", nowMs: now });
        await component.recordHotMemory({
            scopeId: scope.id,
            summary: "Memory tree links stable anchors",
            text: "Vector associations connect ASK closure, scope constitution, and hot memory.",
            symbols: ["ask-closure", "scope-constitution", "hot-memory"],
            importance: 0.9,
            nowMs: now,
        });

        const hits = await component.recall({ scopeId: scope.id, query: "ask closure scope constitution", limit: 2, nowMs: now });
        expect(hits[0]?.scopeId).toBe(scope.id);
        expect(hits[0]?.evidence.symbol).toBeGreaterThan(0);
        expect(tables(join(pathsFromDb(vectorDb).configDir, "brain.db"))).not.toContain("scope_associations");
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

    test("materializes promoted codename evidence into scope.db", async () => {
        const { brain, component, vectorDb } = await fixture();
        const now = Date.now();
        const scope = writeScope(brain, "scope-codename-evidence", "Codename Evidence", "promotion evidence", now);
        const codename: CodenameRecord = {
            id: "cn-evidence",
            name: "flyflor-vector",
            description: "Scope vector evidence",
            createdAt: now,
            lastUsedAt: now,
            useCount: 9,
            scopeId: scope.id,
        };
        brain.upsertCodename(codename);
        await component.syncScopeFromBrain(scope.id);

        const db = new Database(vectorDb);
        try {
            const tree = db
                .query<{ kind: string; source_id: string | null }, []>(
                    "SELECT kind, source_id FROM scope_tree_nodes WHERE kind = 'codename'",
                )
                .all();
            const association = db
                .query<{ term: string; kind: string }, [string]>(
                    "SELECT term, kind FROM scope_associations WHERE scope_id = ? AND kind = 'codename' ORDER BY term",
                )
                .all(scope.id);
            expect(tree).toContainEqual({ kind: "codename", source_id: codename.id });
            expect(association.map((row) => row.term)).toContain("flyflor-vector");
        } finally {
            db.close();
            brain.close();
        }
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

    test("recalls scope-local related rows from the root scope.db hot subtree", async () => {
        const { brain, paths } = await fixture({ explicitVectorDb: false });
        const now = Date.now();
        const rootDir = join(paths.workspaceDir, "root-scope");
        const relatedDir = join(paths.workspaceDir, "related-scope");
        const root = writeScope(brain, "scope-local-root", "Local Root", "scope-local tree root", now, rootDir);
        const related = writeScope(brain, "scope-local-related", "Local Related", "scope-local association leaf", now, relatedDir);
        const component = new ScopeVectorComponent(paths, brain, { vectorDimensions: 32 });
        await component.initialize();
        await component.upsertScope({
            scope: root,
            summary: "Root summary keeps a bounded local tree",
            relatedScopeIds: [related.id],
            nowMs: now,
        });

        const hits = await component.recall({ scopeId: root.id, query: "association leaf", limit: 4, nowMs: now });
        expect(hits.map((hit) => hit.scopeId)).toContain(root.id);
        expect(hits.map((hit) => hit.scopeId)).toContain(related.id);
        expect(tables(join(rootDir, ".flyflor", "scope.db"))).toContain("scope_vectors");
        expect(Bun.file(join(relatedDir, ".flyflor", "scope.db")).exists()).resolves.toBe(false);

        component.dispose();
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

async function fixture(options: { explicitVectorDb?: boolean } = {}): Promise<{
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
    const component =
        options.explicitVectorDb === false
            ? new ScopeVectorComponent(paths, brain, { vectorDimensions: 32 })
            : new ScopeVectorComponent(paths, brain, { dbFile: vectorDb, vectorDimensions: 32 });
    await component.initialize();
    return { brain, component, paths, vectorDb };
}

function writeScope(brain: BrainStore, id: string, title: string, goal: string, now: number, projectDir = join(tmpdir(), id)): ScopeRecord {
    return brain.upsertScope({
        id,
        title,
        goal,
        projectDir,
        projectMemoryDir: join(projectDir, ".flyflor", "memory"),
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
