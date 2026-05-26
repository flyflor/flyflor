import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createDefaultMemoryTuning,
    loadConfigForPaths,
    readModelProviderReadiness,
    type FlyflorPaths,
} from "../src/config/index.ts";
import { RuntimeMode, AtomStage, IdentityFile, SummaryTrigger } from "../src/protocol/contracts/index.ts";

async function makePaths(): Promise<{ paths: FlyflorPaths; root: string }> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-tuning-"));
    const home = join(root, "home");
    const projectDir = join(root, "proj");
    await mkdir(home, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    const paths: FlyflorPaths = {
        home,
        configDir: home,
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        projectDir,
        projectFlyflorDir: join(projectDir, ".flyflor"),
        projectSkillDir: join(projectDir, ".flyflor", "skills"),
        projectMcpDir: join(projectDir, ".flyflor", "mcp"),
        projectPluginDir: join(projectDir, ".flyflor", "plugins"),
        projectMemoryDir: join(projectDir, ".flyflor", "memory"),
        workspaceDir: join(home, "workspace"),
        logDir: join(home, "logs"),
        memoryDir: join(home, "memory"),
        pluginDir: join(home, "plugins"),
        promptDir: join(home, "prompts"),
        skillDir: join(home, "skills"),
        templateDir: join(home, "templates"),
        mcpDir: join(home, "mcp"),
    };
    return { paths, root };
}

const configFileOf = (paths: FlyflorPaths) => join(paths.configDir, "config.jsonc");

describe("LF-P0 memory tuning defaults", () => {
    test("default tuning values are wired through loadConfig", async () => {
        const { paths, root } = await makePaths();
        try {
            const config = await loadConfigForPaths(paths);
            const tuning = config.memory.tuning;
            expect(tuning.identity.appendDailyLimitPerFile).toBe(3);
            expect(tuning.identity.appendOverflowQueue).toBe("dream");
            expect(tuning.summary.trigger).toBe(SummaryTrigger.Rolling);
            expect(tuning.summary.rollingWindowDays).toBe(7);
            expect(tuning.summary.minIntervalHours).toBe(24);
            expect(tuning.hotMemoryCompression.enabled).toBe(true);
            expect(tuning.hotMemoryCompression.intervalMinutes).toBe(30);
            expect(tuning.hotMemoryCompression.batchSize).toBe(16);
            expect(tuning.reconsolidation.embeddingDriftThreshold).toBeCloseTo(0.25);
            expect(tuning.reconsolidation.driftHitCount).toBe(2);
            expect(tuning.inbox.decayMultiplier).toBeCloseTo(2.0);
            expect(tuning.inbox.ttlDays).toBe(7);
            expect(tuning.idle.idleMinutes).toBe(10);
            expect(tuning.idle._keepGatewayListening).toBe(true);
            expect(tuning.brainDb.archiveAfterMonths).toBe(3);
            expect(tuning.brainDb.archiveIntervalHours).toBe(24);
            expect(tuning.brainDb.vacuumIntervalDays).toBe(14);
            expect(tuning.contextFork.sidecarTtlDays).toBe(90);
            expect(tuning.atomScore.weights.recency).toBeCloseTo(0.35);
            expect(tuning.atomScore.weights.access).toBeCloseTo(0.15);
            expect(tuning.atomScore.weights.successPrior).toBeCloseTo(0.35);
            expect(tuning.atomScore.weights.fanout).toBeCloseTo(0.15);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("partial override deep-merges without losing defaults", async () => {
        const { paths, root } = await makePaths();
        try {
            await writeFile(
                configFileOf(paths),
                JSON.stringify({
                    memory: {
                        tuning: {
                            identity: { appendDailyLimitPerFile: 7 },
                            brainDb: { archiveAfterMonths: 6 },
                            hotMemoryCompression: { intervalMinutes: 45 },
                            contextFork: { sidecarTtlDays: 30 },
                            inbox: { ttlDays: 14 },
                        },
                    },
                }),
            );
            const config = await loadConfigForPaths(paths);
            expect(config.memory.tuning.identity.appendDailyLimitPerFile).toBe(7);
            expect(config.memory.tuning.identity.appendOverflowQueue).toBe("dream");
            expect(config.memory.tuning.inbox.ttlDays).toBe(14);
            expect(config.memory.tuning.inbox.decayMultiplier).toBeCloseTo(2.0);
            expect(config.memory.tuning.brainDb.archiveAfterMonths).toBe(6);
            expect(config.memory.tuning.brainDb.archiveIntervalHours).toBe(24);
            expect(config.memory.tuning.brainDb.vacuumIntervalDays).toBe(14);
            expect(config.memory.tuning.hotMemoryCompression.enabled).toBe(true);
            expect(config.memory.tuning.hotMemoryCompression.intervalMinutes).toBe(45);
            expect(config.memory.tuning.hotMemoryCompression.batchSize).toBe(16);
            expect(config.memory.tuning.contextFork.sidecarTtlDays).toBe(30);
            // unrelated blocks keep defaults
            expect(config.memory.tuning.summary.trigger).toBe(SummaryTrigger.Rolling);
            expect(config.memory.tuning.idle.idleMinutes).toBe(10);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("_keepGatewayListening is audit-only: user edits fail fast", async () => {
        const { paths, root } = await makePaths();
        try {
            await writeFile(
                configFileOf(paths),
                JSON.stringify({
                    memory: {
                        tuning: {
                            idle: { _keepGatewayListening: false },
                        },
                    },
                }),
            );
            await expect(loadConfigForPaths(paths)).rejects.toThrow("_keepGatewayListening");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("createDefaultMemoryTuning is stable and returns fresh objects", () => {
        const a = createDefaultMemoryTuning();
        const b = createDefaultMemoryTuning();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        a.identity.appendDailyLimitPerFile = 99;
        expect(b.identity.appendDailyLimitPerFile).toBe(3);
    });

    test("LF-P0 protocol enums are present and stable", () => {
        expect(RuntimeMode.Idle).toBe("idle");
        expect(AtomStage.Raw).toBe("raw");
        expect(AtomStage.Compressed).toBe("compressed");
        expect(AtomStage.Fuzzy).toBe("fuzzy");
        expect(IdentityFile.Identity).toBe("identity.md");
        expect(IdentityFile.User).toBe("user.md");
    });

    test("model provider readiness distinguishes missing, placeholder and configured credentials", async () => {
        const { paths, root } = await makePaths();
        try {
            const missing = readModelProviderReadiness(await loadConfigForPaths(paths));
            expect(missing.ready).toBe(false);
            expect(missing.state).toBe("missing");
            expect(missing.detail).toBe("missing");

            await writeFile(
                configFileOf(paths),
                JSON.stringify({
                    model: {
                        activeProvider: "openai",
                        activeModel: "gpt-5.5",
                        providers: {
                            openai: {
                                apiKey: "replace-with-real-key",
                            },
                        },
                    },
                }),
            );
            const placeholder = readModelProviderReadiness(await loadConfigForPaths(paths));
            expect(placeholder.ready).toBe(false);
            expect(placeholder.state).toBe("placeholder");
            expect(placeholder.detail).toBe("placeholder");

            await writeFile(
                configFileOf(paths),
                JSON.stringify({
                    model: {
                        activeProvider: "openai",
                        activeModel: "gpt-5.5",
                        providers: {
                            openai: {
                                apiKey: "test-live-key",
                            },
                        },
                    },
                }),
            );
            const configured = readModelProviderReadiness(await loadConfigForPaths(paths));
            expect(configured.ready).toBe(true);
            expect(configured.state).toBe("configured");
            expect(configured.detail).toBe("configured");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("model context window is discovered from provider model metadata", async () => {
        const { paths, root } = await makePaths();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response(JSON.stringify({
            data: [
                { id: "custom-1m", context_window: 1_000_000 },
                { id: "custom-small", context_length: 32_000 },
            ],
        }), { status: 200 })) as unknown as typeof fetch;
        try {
            await writeFile(
                configFileOf(paths),
                JSON.stringify({
                    model: {
                        activeProvider: "custom",
                        activeModel: "custom-1m",
                        providers: {
                            custom: {
                                baseUrl: "https://models.example/v1",
                                apiKey: "test-key",
                            },
                        },
                    },
                }),
            );
            const config = await loadConfigForPaths(paths);
            expect(config.model.contextWindowTokens).toBe(1_000_000);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(root, { recursive: true, force: true });
        }
    });

    test("explicit model context window overrides discovered metadata", async () => {
        const { paths, root } = await makePaths();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response(JSON.stringify({
            data: [{ id: "custom-1m", context_window: 1_000_000 }],
        }), { status: 200 })) as unknown as typeof fetch;
        try {
            await writeFile(
                configFileOf(paths),
                JSON.stringify({
                    model: {
                        activeProvider: "custom",
                        activeModel: "custom-1m",
                        providers: {
                            custom: {
                                baseUrl: "https://models.example/v1",
                                apiKey: "test-key",
                                contextWindowTokens: 777_000,
                            },
                        },
                    },
                }),
            );
            const config = await loadConfigForPaths(paths);
            expect(config.model.contextWindowTokens).toBe(777_000);
        } finally {
            globalThis.fetch = originalFetch;
            await rm(root, { recursive: true, force: true });
        }
    });
});
