import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentAsk, RuntimeScope } from "../../../protocol/contracts/index.ts";

export const ContinuationGhostMetadataKey = "continuation" as const;

export const ContinuationGhostResumeMode = {
    Continue: "continue",
} as const;

export type ContinuationGhostResumeMode =
    (typeof ContinuationGhostResumeMode)[keyof typeof ContinuationGhostResumeMode];

export interface ContinuationGhostResumeRequest {
    continuationId?: string;
    mode: ContinuationGhostResumeMode;
    snapshotId?: string;
}

export interface ContinuationGhostSnapshot {
    activeScope?: RuntimeScope;
    ask: AgentAsk;
    continuationId?: string;
    contextForkId?: string;
    createdAt: string;
    executiveToolLoop?: Record<string, unknown>;
    originalUserMessage?: string;
    ownerKey: string;
    requestId?: string;
    snapshotId: string;
    sourceKey?: string;
    sourceSurface?: string;
}

export type ContinuationGhostRequestRead =
    | { ok: true; request?: ContinuationGhostResumeRequest }
    | { ok: false; reason: "invalid-request" };

export type ContinuationGhostLookup =
    | { status: "found"; snapshot: ContinuationGhostSnapshot }
    | { status: "missing" }
    | { status: "invalid" };

/**
 * Runtime-owned ASK ghost snapshot store.
 *
 * The trigger is explicit structured metadata only. This class never inspects
 * user prose for "continue" wording, so pending ASK recovery stays inside the
 * zero-character-matching boundary.
 */
export class ContinuationGhostStore {
    private readonly dir: string;

    public constructor(storageDir: string) {
        this.dir = join(storageDir, "continuation-ghosts");
    }

    public readResumeRequest(metadata: Record<string, unknown> | undefined): ContinuationGhostRequestRead {
        if (!metadata) return { ok: true };
        const raw = metadata[ContinuationGhostMetadataKey];
        if (raw === undefined) return { ok: true };
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return { ok: false, reason: "invalid-request" };
        }
        const record = raw as Record<string, unknown>;
        if (record.mode !== ContinuationGhostResumeMode.Continue) {
            return { ok: false, reason: "invalid-request" };
        }
        const snapshotId = typeof record.snapshotId === "string" && record.snapshotId.trim()
            ? record.snapshotId.trim()
            : undefined;
        const continuationId = typeof record.continuationId === "string" && record.continuationId.trim()
            ? record.continuationId.trim()
            : undefined;
        if (!snapshotId && !continuationId) {
            return { ok: false, reason: "invalid-request" };
        }
        return {
            ok: true,
            request: {
                mode: ContinuationGhostResumeMode.Continue,
                ...(snapshotId ? { snapshotId } : {}),
                ...(continuationId ? { continuationId } : {}),
            },
        };
    }

    public async record(snapshot: ContinuationGhostSnapshot): Promise<void> {
        await mkdir(this.dir, { recursive: true });
        await writeFile(this.fileFor(snapshot.snapshotId), JSON.stringify(snapshot), "utf8");
    }

    public async complete(snapshotId: string): Promise<void> {
        await unlink(this.fileFor(snapshotId)).catch((error) => {
            if ((error as { code?: string }).code !== "ENOENT") {
                throw error;
            }
        });
    }

    public async lookup(request: ContinuationGhostResumeRequest): Promise<ContinuationGhostLookup> {
        await mkdir(this.dir, { recursive: true });
        if (request.snapshotId) {
            return this.readBySnapshotId(request.snapshotId);
        }
        if (!request.continuationId) {
            return { status: "missing" };
        }
        const entries = await readdir(this.dir);
        for (const entry of entries) {
            if (!entry.endsWith(".json")) continue;
            const lookup = await this.readBySnapshotId(entry.slice(0, -".json".length));
            if (lookup.status === "found" && lookup.snapshot.continuationId === request.continuationId) {
                return lookup;
            }
            if (lookup.status === "invalid") {
                return lookup;
            }
        }
        return { status: "missing" };
    }

    private async readBySnapshotId(snapshotId: string): Promise<ContinuationGhostLookup> {
        let raw: string;
        try {
            raw = await readFile(this.fileFor(snapshotId), "utf8");
        } catch (error) {
            if ((error as { code?: string }).code === "ENOENT") {
                return { status: "missing" };
            }
            throw error;
        }
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return { status: "invalid" };
            }
            const snapshot = parsed as Partial<ContinuationGhostSnapshot>;
            if (
                typeof snapshot.snapshotId !== "string" ||
                typeof snapshot.ownerKey !== "string" ||
                !snapshot.ask ||
                typeof snapshot.ask !== "object"
            ) {
                return { status: "invalid" };
            }
            return { status: "found", snapshot: snapshot as ContinuationGhostSnapshot };
        } catch {
            return { status: "invalid" };
        }
    }

    private fileFor(snapshotId: string): string {
        const safe = snapshotId.replace(/[^a-zA-Z0-9_.-]/g, "_");
        return join(this.dir, `${safe}.json`);
    }
}
