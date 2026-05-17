import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BlackboardMode } from "../../../protocol/contracts/index.ts";
import type { FastRouteSnapshot } from "./fast.route.ts";

/**
 * fastRoute 快照存储抽象。
 *
 * 设计约束：
 * - 热路径只允许 O(1) 内存读写。
 * - fastRoute 是性能提示，不能因为缓存状态阻断主 runtime。
 * - 不解析 snapshot 内容做语义判断，纯透传序列化。
 */
export interface FastRouteSnapshotStore {
    get(key: string): Promise<FastRouteSnapshot | undefined>;
    set(key: string, snapshot: FastRouteSnapshot): Promise<void>;
}

interface PersistedFastRouteSnapshotFile {
    version: 1;
    records: Record<string, FastRouteSnapshot>;
}

export interface FileBackedFastRouteSnapshotStoreOptions {
    filePath?: string;
    maxAgeMs?: number;
    maxEntries?: number;
    now?: () => number;
}

const FAST_ROUTE_SNAPSHOT_FILE = "runtime.fast.route.snapshots.json";
const FAST_ROUTE_SNAPSHOT_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 2048;

export class InMemoryFastRouteSnapshotStore implements FastRouteSnapshotStore {
    private readonly map = new Map<string, FastRouteSnapshot>();

    public async get(key: string): Promise<FastRouteSnapshot | undefined> {
        return this.map.get(key);
    }

    public async set(key: string, snapshot: FastRouteSnapshot): Promise<void> {
        this.map.set(key, snapshot);
    }

    public size(): number {
        return this.map.size;
    }
}

export class FileBackedFastRouteSnapshotStore implements FastRouteSnapshotStore {
    private readonly map = new Map<string, FastRouteSnapshot>();
    private readonly filePath: string;
    private readonly maxAgeMs: number;
    private readonly maxEntries: number;
    private readonly now: () => number;
    private hydratePromise: Promise<void> | undefined;
    private persistQueue: Promise<void> = Promise.resolve();

    public constructor(cacheDir: string, options: FileBackedFastRouteSnapshotStoreOptions = {}) {
        this.filePath = options.filePath ?? join(cacheDir, FAST_ROUTE_SNAPSHOT_FILE);
        this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.now = options.now ?? Date.now;
    }

    public async get(key: string): Promise<FastRouteSnapshot | undefined> {
        await this.hydrate();
        return this.map.get(key);
    }

    public async set(key: string, snapshot: FastRouteSnapshot): Promise<void> {
        await this.hydrate();
        this.map.set(key, snapshot);
        this.prune();
        // Keep the write queue usable after a failed fsync/rename while still
        // surfacing the current failure to Runtime telemetry.
        const persistTask = this.persistQueue.then(() => this.persist());
        this.persistQueue = persistTask.catch(() => undefined);
        await persistTask;
    }

    public size(): number {
        return this.map.size;
    }

    /** 明确预热入口；Runtime 可选择冷启动时触发，测试也能直接断言持久化行为。 */
    public async warmup(): Promise<void> {
        await this.hydrate();
    }

    private async hydrate(): Promise<void> {
        this.hydratePromise ??= this.loadFromDisk();
        await this.hydratePromise;
    }

    private async loadFromDisk(): Promise<void> {
        const file = Bun.file(this.filePath);
        if (!(await file.exists())) return;

        try {
            const parsed = JSON.parse(await file.text());
            if (!isPersistedFastRouteSnapshotFile(parsed)) return;
            for (const [key, snapshot] of Object.entries(parsed.records)) {
                if (typeof key === "string" && isFastRouteSnapshot(snapshot)) {
                    this.map.set(key, snapshot);
                }
            }
            this.prune();
        } catch {
            // fastRoute 是性能缓存；损坏文件只视为 cache miss，不影响主请求链路。
            this.map.clear();
        }
    }

    private prune(): void {
        const cutoff = this.now() - this.maxAgeMs;
        for (const [key, snapshot] of this.map) {
            if (snapshot.recordedAt < cutoff) {
                this.map.delete(key);
            }
        }
        const overflow = this.map.size - this.maxEntries;
        if (overflow <= 0) return;
        const oldest = [...this.map.entries()]
            .sort((left, right) => left[1].recordedAt - right[1].recordedAt)
            .slice(0, overflow);
        for (const [key] of oldest) {
            this.map.delete(key);
        }
    }

    private async persist(): Promise<void> {
        await mkdir(dirname(this.filePath), { recursive: true });
        const payload: PersistedFastRouteSnapshotFile = {
            version: FAST_ROUTE_SNAPSHOT_VERSION,
            records: Object.fromEntries(this.map),
        };
        const tempPath = `${this.filePath}.tmp`;
        await Bun.write(tempPath, `${JSON.stringify(payload)}\n`);
        await rename(tempPath, this.filePath);
    }
}

function isPersistedFastRouteSnapshotFile(value: unknown): value is PersistedFastRouteSnapshotFile {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<PersistedFastRouteSnapshotFile>;
    return candidate.version === FAST_ROUTE_SNAPSHOT_VERSION && isRecord(candidate.records);
}

function isFastRouteSnapshot(value: unknown): value is FastRouteSnapshot {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<FastRouteSnapshot>;
    return (
        typeof candidate.recordedAt === "number" &&
        isBlackboardMode(candidate.lastMode) &&
        (candidate.nextRouteHint === undefined || isBlackboardMode(candidate.nextRouteHint)) &&
        (candidate.embedding === undefined || isNumberArray(candidate.embedding)) &&
        (candidate.consecutiveWatchTurns === undefined || typeof candidate.consecutiveWatchTurns === "number") &&
        (candidate.consecutiveBlackboardFailures === undefined ||
            typeof candidate.consecutiveBlackboardFailures === "number") &&
        (candidate.consecutiveToolFailureTurns === undefined ||
            typeof candidate.consecutiveToolFailureTurns === "number")
    );
}

function isBlackboardMode(value: unknown): value is BlackboardMode {
    return (
        value === BlackboardMode.Direct ||
        value === BlackboardMode.DirectWithWatch ||
        value === BlackboardMode.Blackboard
    );
}

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
