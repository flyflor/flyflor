import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createDefaultMemoryTuning,
    loadConfigForPaths,
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
            expect(tuning.reconsolidation.embeddingDriftThreshold).toBeCloseTo(0.25);
            expect(tuning.reconsolidation.driftHitCount).toBe(2);
            expect(tuning.inbox.decayMultiplier).toBeCloseTo(2.0);
            expect(tuning.inbox.ttlDays).toBe(7);
            expect(tuning.dormant.idleMinutes).toBe(10);
            expect(tuning.dormant._keepGatewayListening).toBe(true);
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
            // unrelated blocks keep defaults
            expect(config.memory.tuning.summary.trigger).toBe(SummaryTrigger.Rolling);
            expect(config.memory.tuning.dormant.idleMinutes).toBe(10);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("_keepGatewayListening is audit-only: user edits are silently ignored", async () => {
        const { paths, root } = await makePaths();
        try {
            await writeFile(
                configFileOf(paths),
                JSON.stringify({
                    memory: {
                        tuning: {
                            dormant: { _keepGatewayListening: false },
                        },
                    },
                }),
            );
            const config = await loadConfigForPaths(paths);
            // R behavior contract: never false, regardless of user override.
            expect(config.memory.tuning.dormant._keepGatewayListening).toBe(true);
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
        expect(RuntimeMode.Dormant).toBe("dormant");
        expect(AtomStage.Raw).toBe("raw");
        expect(AtomStage.Compressed).toBe("compressed");
        expect(AtomStage.Fuzzy).toBe("fuzzy");
        expect(IdentityFile.Soul).toBe("soul.md");
        expect(IdentityFile.User).toBe("user.md");
    });
});
