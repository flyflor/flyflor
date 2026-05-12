/**
 * fastRoute 快照存储抽象。
 *
 * 单副本场景：InMemoryFastRouteSnapshotStore（进程内 Map，与历史行为一致）。
 * 多副本场景：RedisFastRouteSnapshotStore，跨副本共享上一轮 nextRouteHint /
 *             lastMode / 升级计数器，避免漂移导致 fastRoute 误判。
 *
 * 设计约束：
 * - 热路径只允许「O(1) L1 内存读 + best-effort 异步 Redis 落盘」，绝不能让 Redis
 *   往返阻塞首轮路由判定（首轮 L1 miss 才走 await get，单 key 一次）。
 * - 失败一律降级：Redis 不可用时退化为 L1 only，保持运行时绿色。
 * - 不解析 snapshot 内容做语义判断，纯透传序列化。
 */
import type Redis from "ioredis";
import type { FastRouteSnapshot } from "./fast.route.ts";

export interface FastRouteSnapshotStore {
    get(key: string): Promise<FastRouteSnapshot | undefined>;
    set(key: string, snapshot: FastRouteSnapshot): Promise<void>;
}

export class InMemoryFastRouteSnapshotStore implements FastRouteSnapshotStore {
    private readonly map = new Map<string, FastRouteSnapshot>();

    async get(key: string): Promise<FastRouteSnapshot | undefined> {
        return this.map.get(key);
    }

    async set(key: string, snapshot: FastRouteSnapshot): Promise<void> {
        this.map.set(key, snapshot);
    }

    size(): number {
        return this.map.size;
    }
}

export interface RedisFastRouteSnapshotStoreOptions {
    /** 仅可注入 ioredis 客户端；HTTP/REST 模式不支持。 */
    redis: Redis;
    /** Redis key 前缀，默认 "ff:fastroute"。 */
    prefix?: string;
    /** TTL（秒），默认 3600s（1 小时）。 */
    ttlSeconds?: number;
}

/**
 * L1（进程内 Map） + L2（Redis）双层存储。
 * - get：L1 命中直接返回；miss 则 await Redis GET，反序列化后填回 L1。
 * - set：同步写 L1，fire-and-forget 写 Redis（带 TTL）；Redis 失败仅吞掉。
 */
export class RedisFastRouteSnapshotStore implements FastRouteSnapshotStore {
    private readonly l1 = new Map<string, FastRouteSnapshot>();
    private readonly redis: Redis;
    private readonly prefix: string;
    private readonly ttlSeconds: number;

    constructor(options: RedisFastRouteSnapshotStoreOptions) {
        this.redis = options.redis;
        this.prefix = options.prefix ?? "ff:fastroute";
        this.ttlSeconds = Math.max(1, options.ttlSeconds ?? 3600);
    }

    private keyFor(key: string): string {
        return `${this.prefix}:${key}`;
    }

    async get(key: string): Promise<FastRouteSnapshot | undefined> {
        const cached = this.l1.get(key);
        if (cached) return cached;
        try {
            const raw = await this.redis.get(this.keyFor(key));
            if (!raw) return undefined;
            const parsed = JSON.parse(raw) as FastRouteSnapshot;
            this.l1.set(key, parsed);
            return parsed;
        } catch {
            return undefined;
        }
    }

    async set(key: string, snapshot: FastRouteSnapshot): Promise<void> {
        this.l1.set(key, snapshot);
        try {
            const payload = JSON.stringify(snapshot);
            await this.redis.set(this.keyFor(key), payload, "EX", this.ttlSeconds);
        } catch {
            // swallow: L1 already updated, next get will still work locally.
        }
    }
}
