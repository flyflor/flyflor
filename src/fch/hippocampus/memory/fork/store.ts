import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Component } from "../../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../../components/component.ts";
import type { ContextForkRecord } from "../../../../protocol/contracts/index.ts";

const FORK_STORE_SCHEMA_VERSION = 1;

export interface ContextForkStoreSource {
    assistantText?: string;
    eventId?: string;
    userText?: string;
}

export interface ContextForkSidecarRecord {
    schemaVersion: 1;
    fork: ContextForkRecord;
    source?: ContextForkStoreSource;
    writtenAt: string;
}

@Component()
export class ContextForkStore extends MemoryComponent {
    public constructor(private readonly rootDir: string) {
        super();
    }

    /**
     * Cold sidecar for low-frequency fork replay. brain.db keeps the searchable
     * summary/index; this store keeps optional replay detail outside the hot DB.
     */
    public async writeFork(record: ContextForkRecord, source?: ContextForkStoreSource): Promise<ContextForkSidecarRecord> {
        const dir = this.forkDir(record.id);
        await mkdir(dir, { recursive: true });
        const sidecar: ContextForkSidecarRecord = {
            schemaVersion: FORK_STORE_SCHEMA_VERSION,
            fork: record,
            source,
            writtenAt: new Date().toISOString(),
        };
        await Bun.write(join(dir, "manifest.json"), `${JSON.stringify(sidecar, null, 2)}\n`);
        if (source) {
            await Bun.write(
                join(dir, "replay.jsonl"),
                `${JSON.stringify({
                    schemaVersion: FORK_STORE_SCHEMA_VERSION,
                    type: "context-fork.replay",
                    forkId: record.id,
                    source,
                    writtenAt: sidecar.writtenAt,
                })}\n`,
            );
        }
        return sidecar;
    }

    public async readFork(forkId: string): Promise<ContextForkSidecarRecord | null> {
        const path = join(this.forkDir(forkId), "manifest.json");
        const file = Bun.file(path);
        if (!(await file.exists())) return null;
        const parsed = JSON.parse(await file.text()) as ContextForkSidecarRecord;
        if (parsed.schemaVersion !== FORK_STORE_SCHEMA_VERSION || parsed.fork?.id !== forkId) {
            throw new Error(`Invalid context fork sidecar: ${path}`);
        }
        return parsed;
    }

    /**
     * TTL cleanup removes cold replay directories only. The brain.db summary row
     * remains available for audit/history unless a future explicit archive path
     * marks it separately.
     */
    public async cleanupExpired(input: { nowMs?: number; ttlDays: number }): Promise<{ removed: number }> {
        const ttlMs = Math.max(0, input.ttlDays) * 24 * 60 * 60_000;
        if (ttlMs <= 0) return { removed: 0 };
        const nowMs = input.nowMs ?? Date.now();
        const root = this.rootDir;
        let entries: string[];
        try {
            entries = await readdir(root);
        } catch {
            return { removed: 0 };
        }
        let removed = 0;
        for (const entry of entries) {
            const sidecar = await this.readFork(entry).catch(() => null);
            if (!sidecar) continue;
            const updatedAt = Date.parse(sidecar.fork.updatedAt);
            if (!Number.isFinite(updatedAt) || nowMs - updatedAt <= ttlMs) continue;
            await rm(this.forkDir(entry), { force: true, recursive: true });
            removed += 1;
        }
        return { removed };
    }

    private forkDir(forkId: string): string {
        return join(this.rootDir, ContextForkStore.sanitizeForkId(forkId));
    }

    private static sanitizeForkId(forkId: string): string {
        return forkId.replace(/[^A-Za-z0-9.-]/gu, "-");
    }
}
