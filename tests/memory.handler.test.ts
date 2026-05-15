import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlyFlorTokens } from "../src/app.ts";
import { fetchMemoryData } from "../src/command/cli/handlers/memory.handler.ts";
import type { FlyflorConfig } from "../src/config/index.ts";

describe("memory CLI handler", () => {
    test("surfaces working memory breaker health", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-memory-handler-"));
        try {
            const app = fakeApp(config(root), {
                backend: "local",
                circuitState: "open",
                lastError: "disk outage",
                nextRecoveryAt: Date.UTC(2026, 4, 15, 12),
            });

            const data = await fetchMemoryData(app as never);

            expect(data.workingMemoryStatus.status).toBe("warn");
            expect(data.workingMemoryStatus.detail).toContain("local circuit open");
            expect(data.workingMemoryStatus.detail).toContain("disk outage");
            expect(data.workingMemoryStatus.detail).toContain("next probe");
            expect(data.workingRecoveryStatus.detail).toContain("local");
            expect(data.workingRecoveryStatus.detail).toContain("snapshot=missing");
            expect(data.workingRecoveryStatus.detail).toContain("backup=missing");
            expect(data.workingRecoveryStatus.detail).toContain("wal=missing");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

function fakeApp(config: FlyflorConfig, workingMemorySnapshot: unknown) {
    return {
        resolve(token: unknown) {
            if (token === FlyFlorTokens.Config) return config;
            if (token === FlyFlorTokens.Memory) {
                return {
                    getWorkingMemoryHealthSnapshot: () => workingMemorySnapshot,
                };
            }
            throw new Error("unexpected token");
        },
    };
}

function config(root: string): FlyflorConfig {
    return {
        paths: {
            memoryDir: join(root, "memory"),
            projectMemoryDir: join(root, "project-memory"),
            storageDir: join(root, "storage"),
        },
        memory: {
            enabled: true,
            crystal: {
                enabled: true,
                backend: "local",
                local: { dbFile: join(root, "crystal.db") },
            },
            embedding: { dimensions: 64 },
            sqlite: { enabled: true },
        },
    } as unknown as FlyflorConfig;
}
