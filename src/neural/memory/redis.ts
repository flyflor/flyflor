import { Redis } from "ioredis";
import type { RedisMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";

/**
 * 海马体工作记忆 Redis 客户端：封装 ff:* 四类 key 的 CRUD。
 *
 * Key 协议（与 README.md §5.2 工作记忆 对齐）：
 *   ff:ep:{userId}:{episodeId}    HASH   episode 全字段 + EXPIRE TTL
 *   ff:ctx:{userId}               LIST   最近 N 轮上下文 ring buffer（LPUSH+LTRIM）
 *   ff:cq:{userId}                ZSET   整合候选队列，score = 预期 review 时间戳
 *   ff:act:{userId}               ZSET   概念激活热度，member = conceptTag, score = 时间戳
 *
 * 设计约束：
 * - **零业务字符串匹配**：本类只负责 key/value 的二进制结构，不解析 episode 内
 *   text 做语义判断。Episode 的 importance/concepts 等字段必须由调用方算好后传入。
 * - **best-effort 热路径**：所有读/写在 timeoutMs 内必须 resolve 或 reject；
 *   失败由 MemoryModule 捕获并降级，不阻塞主回答。
 * - 单例：每个进程只创建一个 client；命名空间通过 RedisMemoryConfig.namespace 注入
 *   `ff:` 前缀本身可改写成 `<namespace>:` 形式，但默认就用 ff（FlyFlor）。
 */
@Component({ name: "redis-memory-store", tags: ["database", "memory", "hippocampus"] })
export class RedisMemoryStore {
    private readonly client: Redis;
    private readonly prefix: string;
    private readonly timeoutMs: number;
    private readonly defaultTtlSeconds: number;
    private readonly maxEpisodesPerUser: number;
    private readonly contextRingSize: number;
    private connectPromise: Promise<void> | undefined;

    constructor(private readonly config: RedisMemoryConfig) {
        this.client = new Redis(config.internalUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: config.timeoutMs,
            commandTimeout: config.timeoutMs,
        });
        // namespace 默认 "flyflor"；Redis key 实际前缀使用 "ff:" 缩写以省网络带宽。
        // 多租户/多 agent 共享同一 Redis 时，可改 namespace 切分逻辑。
        this.prefix = `ff`;
        this.timeoutMs = config.timeoutMs;
        this.defaultTtlSeconds = config.defaultTtlSeconds;
        this.maxEpisodesPerUser = config.maxEpisodesPerUser;
        this.contextRingSize = config.contextRingSize;
    }

    async connect(): Promise<void> {
        if (this.client.status === "ready") {
            return;
        }
        this.connectPromise ??= this.client.connect().finally(() => {
            this.connectPromise = undefined;
        });
        await this.connectPromise;
    }

    /**
     * 预热：connect + PING 往返确认。
     * 返回 RTT（ms）；失败抛出。
     */
    async ping(): Promise<number> {
        await this.connect();
        const start = Date.now();
        await this.client.ping();
        return Date.now() - start;
    }

    async disconnect(): Promise<void> {
        await this.client.quit();
    }

    dispose(): void {
        this.client.disconnect();
    }

    isReady(): boolean {
        return this.client.status === "ready";
    }

    /** 暴露底层 ioredis 客户端，供同 namespace 的其他模块（fastRoute 快照等）共享。 */
    getClient(): Redis {
        return this.client;
    }

    /**
     * 写入 episode + 同步刷新 ring buffer + consolidation 队列 + 强制遗忘。
     * 调用方必须先算好 stability/ttlSeconds（基于 importance × multiplier）。
     */
    async writeEpisode(input: EpisodeWriteInput): Promise<EpisodeWriteResult> {
        await this.connect();
        const epKey = this.episodeKey(input.userId, input.episodeId);
        const cqKey = this.consolidationKey(input.userId);
        const ctxKey = this.contextKey(input.userId);
        const ttl = Math.max(1, Math.floor(input.ttlSeconds ?? this.defaultTtlSeconds));
        // consolidation review 时间 = 现在 + TTL × 0.8（提前 20% 触发整合决策）
        const reviewAt = Math.floor(Date.now() / 1000) + Math.floor(ttl * 0.8);

        // 强制遗忘：先量队列长度，超限就弹掉最旧的 episode（同时删 hash）
        const forced = await this.enforceUserCapacity(input.userId);

        const pipeline = this.client.pipeline();
        pipeline.hset(epKey, this.encodeEpisodeFields(input));
        pipeline.expire(epKey, ttl);
        pipeline.zadd(cqKey, reviewAt, input.episodeId);
        pipeline.lpush(ctxKey, input.episodeId);
        pipeline.ltrim(ctxKey, 0, this.contextRingSize - 1);
        // ctx ring 同样过期，避免离线用户的 list 永远占内存
        pipeline.expire(ctxKey, ttl * 2);
        await pipeline.exec();

        return { episodeId: input.episodeId, ttlSeconds: ttl, reviewAt, forcedForgotten: forced };
    }

    async readEpisode(userId: string, episodeId: string): Promise<EpisodeRecord | undefined> {
        await this.connect();
        const data = await this.client.hgetall(this.episodeKey(userId, episodeId));
        if (!data || Object.keys(data).length === 0) {
            return undefined;
        }
        return this.decodeEpisodeFields(episodeId, data);
    }

    async readContextRing(userId: string, limit: number): Promise<string[]> {
        await this.connect();
        // ring buffer 从 head 读取最近 N 条 episodeId（按写入新→旧）
        return await this.client.lrange(this.contextKey(userId), 0, Math.max(0, limit - 1));
    }

    async listConsolidationCandidates(userId: string, until: number, limit: number): Promise<string[]> {
        await this.connect();
        // 整合 worker 用：取所有 reviewAt <= now 的 episode
        return await this.client.zrangebyscore(this.consolidationKey(userId), 0, until, "LIMIT", 0, limit);
    }

    async dropEpisode(userId: string, episodeId: string): Promise<void> {
        await this.connect();
        // CONSOLIDATE / DISCARD 决策完毕后回收 Redis 占用
        const pipeline = this.client.pipeline();
        pipeline.del(this.episodeKey(userId, episodeId));
        pipeline.zrem(this.consolidationKey(userId), episodeId);
        await pipeline.exec();
    }

    async reinforceEpisode(userId: string, episodeId: string, ttlSeconds: number): Promise<boolean> {
        await this.connect();
        const epKey = this.episodeKey(userId, episodeId);
        const exists = await this.client.exists(epKey);
        if (!exists) return false;
        const ttl = Math.max(1, Math.floor(ttlSeconds));
        const reviewAt = Math.floor(Date.now() / 1000) + Math.floor(ttl * 0.8);
        const pipeline = this.client.pipeline();
        pipeline.expire(epKey, ttl);
        pipeline.zadd(this.consolidationKey(userId), reviewAt, episodeId);
        pipeline.expire(this.contextKey(userId), ttl * 2);
        await pipeline.exec();
        return true;
    }

    /** 原地改写 episode（dream rewrite 决策）：保留 id 与 createdAt，重写 text/concepts/importance。 */
    async rewriteEpisode(
        userId: string,
        episodeId: string,
        patch: { text?: string; concepts?: string[]; importance?: number; metadata?: Record<string, unknown> },
    ): Promise<boolean> {
        await this.connect();
        const existing = await this.readEpisode(userId, episodeId);
        if (!existing) return false;
        const fields: Record<string, string> = {};
        if (typeof patch.text === "string") fields.text = patch.text;
        if (Array.isArray(patch.concepts)) fields.concepts = JSON.stringify(patch.concepts);
        if (typeof patch.importance === "number" && Number.isFinite(patch.importance)) {
            fields.importance = String(patch.importance);
        }
        if (patch.metadata && typeof patch.metadata === "object") {
            fields.metadata = JSON.stringify({ ...existing.metadata, ...patch.metadata });
        }
        if (Object.keys(fields).length === 0) return true;
        await this.client.hset(this.episodeKey(userId, episodeId), fields);
        return true;
    }

    async touchConcepts(userId: string, concepts: string[]): Promise<void> {
        if (concepts.length === 0) {
            return;
        }
        await this.connect();
        const now = Date.now();
        const args: (string | number)[] = [];
        for (const concept of concepts) {
            args.push(now, concept);
        }
        await this.client.zadd(this.activationKey(userId), ...args);
        // ZSET 也加 TTL，避免静默用户的热度榜永久占内存
        await this.client.expire(this.activationKey(userId), this.defaultTtlSeconds * 2);
    }

    async hotConcepts(userId: string, limit: number): Promise<string[]> {
        await this.connect();
        // 返回最近激活的 top N 概念（按时间戳倒序）
        return await this.client.zrevrange(this.activationKey(userId), 0, Math.max(0, limit - 1));
    }

    private async enforceUserCapacity(userId: string): Promise<string[]> {
        const cqKey = this.consolidationKey(userId);
        const count = await this.client.zcard(cqKey);
        if (count < this.maxEpisodesPerUser) {
            return [];
        }
        const overflow = count - this.maxEpisodesPerUser + 1;
        // ZPOPMIN 同时返回 episodeId 和 score；这里只用 episodeId 删 hash
        const popped = (await this.client.zpopmin(cqKey, overflow)) as string[];
        const droppedIds: string[] = [];
        const pipeline = this.client.pipeline();
        for (let i = 0; i < popped.length; i += 2) {
            const episodeId = popped[i]!;
            droppedIds.push(episodeId);
            pipeline.del(this.episodeKey(userId, episodeId));
        }
        if (droppedIds.length > 0) {
            await pipeline.exec();
        }
        return droppedIds;
    }

    private encodeEpisodeFields(input: EpisodeWriteInput): Record<string, string> {
        return {
            id: input.episodeId,
            userId: input.userId,
            text: input.text,
            // 复杂字段统一 JSON 串行化；Redis HASH 不适合存嵌套结构
            concepts: JSON.stringify(input.concepts),
            embedding: JSON.stringify(input.embedding ?? []),
            importance: String(input.importance),
            stability: String(input.stability),
            sourceKind: input.sourceKind,
            createdAt: String(input.createdAt ?? Date.now()),
            metadata: JSON.stringify(input.metadata ?? {}),
        };
    }

    private decodeEpisodeFields(episodeId: string, raw: Record<string, string>): EpisodeRecord {
        return {
            episodeId,
            userId: raw.userId ?? "",
            text: raw.text ?? "",
            concepts: safeJsonArray(raw.concepts),
            embedding: safeJsonNumberArray(raw.embedding),
            importance: Number(raw.importance ?? 0),
            stability: Number(raw.stability ?? 0),
            sourceKind: raw.sourceKind ?? "",
            createdAt: Number(raw.createdAt ?? 0),
            metadata: safeJsonObject(raw.metadata),
        };
    }

    private episodeKey(userId: string, episodeId: string): string {
        return `${this.prefix}:ep:${userId}:${episodeId}`;
    }

    private contextKey(userId: string): string {
        return `${this.prefix}:ctx:${userId}`;
    }

    private consolidationKey(userId: string): string {
        return `${this.prefix}:cq:${userId}`;
    }

    private activationKey(userId: string): string {
        return `${this.prefix}:act:${userId}`;
    }
}

export interface EpisodeWriteInput {
    userId: string;
    episodeId: string;
    text: string;
    concepts: string[];
    embedding?: number[];
    importance: number;
    stability: number;
    sourceKind: string;
    createdAt?: number;
    ttlSeconds?: number;
    metadata?: Record<string, unknown>;
}

export interface EpisodeWriteResult {
    episodeId: string;
    ttlSeconds: number;
    reviewAt: number;
    forcedForgotten: string[];
}

export interface EpisodeRecord {
    episodeId: string;
    userId: string;
    text: string;
    concepts: string[];
    embedding: number[];
    importance: number;
    stability: number;
    sourceKind: string;
    createdAt: number;
    metadata: Record<string, unknown>;
}

function safeJsonArray(value: string | undefined): string[] {
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
        throw new Error("Redis episode field expected a JSON array.");
    }
    return parsed.map(String);
}

function safeJsonNumberArray(value: string | undefined): number[] {
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
        throw new Error("Redis episode field expected a JSON number array.");
    }
    return parsed.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

function safeJsonObject(value: string | undefined): Record<string, unknown> {
    if (!value) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Redis episode field expected a JSON object.");
    }
    return parsed as Record<string, unknown>;
}
