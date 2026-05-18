import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    describeBackgroundScheduler,
    describeBrainDb,
    describeIdentityActivity,
    describeModelApiKey,
    renderDoctor,
    describeWorkingMemoryHealth,
    describeWorkingMemoryRecoveryFiles} from "../src/command/cli/status.ts";
import { GatewayModule, MemoryModule } from "../src/app.ts";
import { ConfigComponent, createDefaultMemoryTuning, type FlyflorConfig } from "../src/config/index.ts";
import { BrainStore } from "../src/fch/hippocampus/memory/brain/store.ts";
import {
    CrystalMemoryBackend,
    MemoryEventStatus,
    MemoryEventType,
    MemoryLinkType,
    ModelApiMode,
    SandboxMode,
    MemoryWorkingBackend,
    SummaryRange,
    ToolApprovalMode} from "../src/protocol/contracts/index.ts";

function configForHome(home: string): FlyflorConfig {
    return { paths: { configDir: home, home } } as FlyflorConfig;
}

function doctorConfigForHome(home: string): FlyflorConfig {
    return {
        paths: {
            home,
            configDir: join(home, "config"),
            storageDir: join(home, "storage"),
            cacheDir: join(home, "cache"),
            projectDir: join(home, "project"),
            projectFlyflorDir: join(home, "project", ".flyflor"),
            projectSkillDir: join(home, "project", ".flyflor", "skills"),
            projectMcpDir: join(home, "project", ".flyflor", "mcp"),
            projectPluginDir: join(home, "project", ".flyflor", "plugins"),
            projectMemoryDir: join(home, "project", ".flyflor", "memory"),
            workspaceDir: join(home, "workspace"),
            logDir: join(home, "logs"),
            memoryDir: join(home, "memory"),
            pluginDir: join(home, "plugins"),
            promptDir: join(home, "prompts"),
            skillDir: join(home, "skills"),
            templateDir: join(home, "templates"),
            mcpDir: join(home, "mcp")},
        gateway: {
            host: "127.0.0.1",
            port: 1,
            stdio: false,
            allowedChannels: [],
            channelReplyUrls: {},
            channels: {
                wechat: {},
                weixinIlink: { pollIntervalMs: 60_000 }}},
        memory: {
            enabled: true,
            crystal: {
                backend: CrystalMemoryBackend.Local,
                enabled: true,
                local: { dbFile: join(home, "crystal.db") }},
            working: { backend: MemoryWorkingBackend.Local },
            tuning: createDefaultMemoryTuning()},
        metrics: {},
        model: {
            apiMode: ModelApiMode.Responses,
            provider: "openai",
            providerId: "openai",
            apiKey: "REPLACE_ME_TEST_API_KEY",
            baseUrl: "https://api.openai.com/v1",
            headers: {},
            maxTokens: 1024,
            model: "gpt-4.1-mini",
            temperature: 0,
            timeoutMs: 30_000},
        routing: {},
        sandbox: {
            mode: SandboxMode.Off,
            mcpToolApproval: ToolApprovalMode.Deny,
            pluginApproval: ToolApprovalMode.Deny,
            shellHookApproval: ToolApprovalMode.Deny}} as unknown as FlyflorConfig;
}

describe("doctor Brain.db visibility", () => {
    test("reports main size, archive files, and core table counts", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-doctor-brain-"));
        try {
            const brain = new BrainStore({ dbPath: join(root, "brain.db") });
            await brain.open();
            try {
                const ts = Date.UTC(2026, 4, 14);
                brain.appendEvent({ id: "e1", ts, userId: "u1", type: MemoryEventType.Event, content: {} });
                brain.appendEvent({ id: "e2", ts: ts + 1, userId: "u1", type: MemoryEventType.Event, content: {} });
                brain.upsertState("e1", { status: MemoryEventStatus.Live });
                brain.writeSummary({
                    id: "s1",
                    timeRange: SummaryRange.Day,
                    bucketKey: "2026-05-14",
                    content: "{}",
                    createdAt: ts});
                brain.writeLink({
                    id: "l1",
                    fromId: "e1",
                    toId: "e2",
                    strength: 1,
                    type: MemoryLinkType.Derived,
                    createdAt: ts});
                brain.upsertCodename({
                    id: "c1",
                    name: "demo",
                    userId: "u1",
                    createdAt: ts,
                    lastUsedAt: ts,
                    useCount: 1});
            } finally {
                brain.close();
            }

            // Archive files are counted by filename convention; doctor does not ATTACH or scan them.
            await mkdir(join(root, "archive"), { recursive: true });
            await writeFile(join(root, "archive", "brain.2026-04.db"), "");

            const summary = await describeBrainDb(configForHome(root));

            expect(summary.status).toBe("ok");
            expect(summary.detail).toContain("main");
            expect(summary.detail).toContain("1 archive file(s)");
            expect(summary.detail).toContain("events=2");
            expect(summary.detail).toContain("state=1");
            expect(summary.detail).toContain("summaries=1");
            expect(summary.detail).toContain("links=1");
            expect(summary.detail).toContain("codenames=1");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("warns before brain.db is initialized", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-doctor-empty-"));
        try {
            const summary = await describeBrainDb(configForHome(root));

            expect(summary.status).toBe("warn");
            expect(summary.detail).toContain("not initialized yet");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe("doctor diagnostics visibility", () => {
    test("marks direct memory diagnostics as AtomScore bypass", async () => {
        const config = doctorConfigForHome("/tmp/flyflor-doctor-debug");
        const app = {
            resolve(token: unknown) {
                if (token === ConfigComponent) return config;
                if (token === GatewayModule) {
                    return {
                        getStatusSnapshot: () => ({
                            channels: [],
                            connectedCount: 0,
                            degradedCount: 0,
                            gatewayRunning: false,
                            host: "127.0.0.1",
                            port: 1,
                            streamingCount: 0})};
                }
                if (token === MemoryModule) return { getWorkingMemoryHealthSnapshot: () => undefined };
                return {};
            }};

        const output = await renderDoctor(app as never);

        expect(output).toContain("Memory diagnostics");
        expect(output).toContain("bypass-score=true");
    });
});

describe("doctor background scheduler visibility", () => {
    test("local working memory plus local crystal graph is reported as enabled", () => {
        const summary = describeBackgroundScheduler({
            memory: {
                crystal: {
                    backend: CrystalMemoryBackend.Local,
                    enabled: true,
                    local: { dbFile: "/tmp/crystal.db" }},
                working: {
                    backend: MemoryWorkingBackend.Local}}} as FlyflorConfig);

        expect(summary.status).toBe("ok");
        expect(summary.detail).toContain("local working-memory");
    });

    test("disabled crystal backend is not part of the main scheduler path", () => {
        const summary = describeBackgroundScheduler({
            memory: {
                crystal: {
                    backend: CrystalMemoryBackend.Local,
                    enabled: false,
                    local: {}},
                working: {
                    backend: MemoryWorkingBackend.Local}}} as FlyflorConfig);

        expect(summary.status).toBe("warn");
        expect(summary.detail).toContain("local crystal graph");
    });
});

describe("doctor identity activity visibility", () => {
    test("reports recent identity writes and live pending review rows", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-doctor-identity-"));
        try {
            const brain = new BrainStore({ dbPath: join(root, "brain.db") });
            await brain.open();
            try {
                const now = Date.UTC(2026, 4, 15);
                brain.appendEvent({
                    id: "identity-recent-live",
                    ts: now - 60_000,
                    userId: "u1",
                    type: MemoryEventType.IdentityAppend,
                    content: { kind: "preference", content: "recent", confidence: 1 }});
                brain.appendEvent({
                    id: "identity-recent-reverted",
                    ts: now - 120_000,
                    userId: "u1",
                    type: MemoryEventType.IdentityAppend,
                    content: { kind: "goal", content: "reverted", confidence: 1 }});
                brain.upsertState("identity-recent-reverted", { status: MemoryEventStatus.Abandoned });
                brain.appendEvent({
                    id: "identity-old-live",
                    ts: now - 10 * 24 * 60 * 60_000,
                    userId: "u1",
                    type: MemoryEventType.IdentityAppend,
                    content: { kind: "constraint", content: "old", confidence: 1 }});
            } finally {
                brain.close();
            }

            const summary = await describeIdentityActivity(configForHome(root), { nowMs: Date.UTC(2026, 4, 15) });

            expect(summary.status).toBe("ok");
            expect(summary.detail).toContain("last7d=2");
            expect(summary.detail).toContain("pendingReview=2");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe("doctor model credential visibility", () => {
    test("treats placeholder provider keys as not configured", () => {
        expect(describeModelApiKey("REPLACE_ME_FASTAI_API_KEY")).toEqual({
            configured: false,
            detail: "placeholder",
            status: "warn"});
        expect(describeModelApiKey("sk-test-realistic")).toEqual({
            configured: true,
            detail: "configured",
            status: "ok"});
    });
});

describe("doctor working memory health visibility", () => {
    test("reports a local working memory snapshot without treating lazy load as failure", () => {
        const summary = describeWorkingMemoryHealth({
            backend: "local",
            circuitState: "closed",
            loaded: false,
            loadedFrom: "empty",
            recoveredFromBackup: false,
            replayedWalRecords: 0,
            tornWalLines: 0});

        expect(summary.status).toBe("ok");
        expect(summary.detail).toContain("local not loaded");
    });

    test("surfaces backup recovery and WAL replay counters", () => {
        const summary = describeWorkingMemoryHealth({
            backend: "local",
            circuitState: "closed",
            loaded: true,
            loadedFrom: "backup+wal",
            recoveredFromBackup: true,
            replayedWalRecords: 12,
            tornWalLines: 1});

        expect(summary.status).toBe("ok");
        expect(summary.detail).toContain("backup recovered");
        expect(summary.detail).toContain("wal=12");
        expect(summary.detail).toContain("torn=1");
    });

    test("warns when the working memory circuit breaker is open", () => {
        const summary = describeWorkingMemoryHealth({
            backend: "local",
            circuitState: "open",
            lastError: "disk outage",
            loaded: true});

        expect(summary.status).toBe("warn");
        expect(summary.detail).toContain("circuit open");
        expect(summary.detail).toContain("disk outage");
    });

    test("surfaces local recovery files without opening working-memory data", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-doctor-working-recovery-"));
        try {
            await mkdir(join(root, "memory"), { recursive: true });
            await writeFile(join(root, "memory", "working.snapshot.json"), "{}", "utf8");
            await writeFile(join(root, "memory", "working.snapshot.json.bak"), "{}", "utf8");
            await writeFile(join(root, "memory", "working.wal.jsonl"), "x\n", "utf8");

            const summary = await describeWorkingMemoryRecoveryFiles(doctorConfigForHome(root));

            expect(summary.status).toBe("ok");
            expect(summary.detail).toContain("local");
            expect(summary.detail).toContain("snapshot=2 B");
            expect(summary.detail).toContain("backup=2 B");
            expect(summary.detail).toContain("wal=2 B");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

});
