import { Redis } from "ioredis";
import type { RedisMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../agent/components.ts";
import type { EpisodeRecord, EpisodeWriteInput, EpisodeWriteResult, RedisBackedWorkingMemoryStore } from "./working.store.ts";

export type { EpisodeRecord, EpisodeWriteInput, EpisodeWriteResult } from "./working.store.ts";

type RedisCircuitState = "closed" | "open";

export interface RedisWorkingMemoryHealthSnapshot {
    backend: "redis";
    circuitState: RedisCircuitState;
    failureCount: number;
    lastError?: string;
    lastRecoveredAt?: number;
    nextRetryAt?: number;
    ready: boolean;
}

function createStorageError(code: string, message: string): Error & { code: string } {
    const error = new Error(message);
    (error as Error & { code: string }).code = code;
    return error as Error & { code: string };
}

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
export class RedisMemoryStore extends MemoryComponent implements RedisBackedWorkingMemoryStore {
    private readonly client: Redis;
    private readonly prefix: string;
    private readonly timeoutMs: number;
    private readonly defaultTtlSeconds: number;
    private readonly maxEpisodesPerUser: number;
    private readonly contextRingSize: number;
    private circuitState: RedisCircuitState = "closed";
    private connectPromise: Promise<void> | undefined;
    private failureCount = 0;
    private lastError: string | undefined;
    private lastRecoveredAt: number | undefined;
    private nextRetryAt: number | undefined;

    public constructor(private readonly config: RedisMemoryConfig) {
        super();
        this.client = new Redis(config.internalUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: config.timeoutMs,
            commandTimeout: config.timeoutMs,
        });
        // namespace 默认 "flyflor"；默认 key 保持历史短前缀 "ff:"，自定义 namespace 隔离多 agent / 多环境。
        this.prefix = redisKeyPrefixForNamespace(config.namespace);
        this.timeoutMs = config.timeoutMs;
        this.defaultTtlSeconds = config.defaultTtlSeconds;
        this.maxEpisodesPerUser = config.maxEpisodesPerUser;
        this.contextRingSize = config.contextRingSize;
    }

    public async connect(): Promise<void> {
        this.ensureCircuitProbeAllowed();
        if (this.client.status === "ready") {
            if (this.circuitState !== "closed") {
                this.closeCircuit();
            }
            return;
        }
        try {
            this.connectPromise ??= this.client.connect().finally(() => {
                this.connectPromise = undefined;
            });
            await this.connectPromise;
            if (this.circuitState !== "closed") {
                this.closeCircuit();
            }
        } catch (error) {
            this.tripCircuit(error);
            throw error;
        }
    }

    /**
     * 预热：connect + PING 往返确认。
     * 返回 RTT（ms）；失败抛出。
     */
    public async ping(): Promise<number> {
        return await this.withCircuit(async () => {
            const start = Date.now();
            await this.client.ping();
            return Date.now() - start;
        });
    }

    public async disconnect(): Promise<void> {
        await this.client.quit();
    }

    public dispose(): void {
        this.client.disconnect();
    }

    public isReady(): boolean {
        return this.client.status === "ready" && this.circuitState === "closed";
    }

    public getHealthSnapshot(): RedisWorkingMemoryHealthSnapshot {
        return {
            backend: "redis",
            circuitState: this.circuitState,
            failureCount: this.failureCount,
            lastError: this.lastError,
            lastRecoveredAt: this.lastRecoveredAt,
            nextRetryAt: this.nextRetryAt,
            ready: this.client.status === "ready",
        };
    }

    /** 暴露底层 ioredis 客户端，供同 namespace 的其他模块（fastRoute 快照等）共享。 */
    public getClient(): Redis {
        return this.client;
    }

    /**
     * 写入 episode + 同步刷新 ring buffer + consolidation 队列 + 强制遗忘。
     * 调用方必须先算好 stability/ttlSeconds（基于 importance × multiplier）。
     */
    public async writeEpisode(input: EpisodeWriteInput): Promise<EpisodeWriteResult> {
        return await this.withCircuit(async () => {
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
        });
    }

    public async readEpisode(userId: string, episodeId: string): Promise<EpisodeRecord | undefined> {
        return await this.withCircuit(async () => {
            const data = await this.client.hgetall(this.episodeKey(userId, episodeId));
            if (!data || Object.keys(data).length === 0) {
                return undefined;
            }
            return this.decodeEpisodeFields(episodeId, data);
        });
    }

    public async readContextRing(userId: string, limit: number): Promise<string[]> {
        return await this.withCircuit(async () => {
            // ring buffer 从 head 读取最近 N 条 episodeId（按写入新→旧）
            return await this.client.lrange(this.contextKey(userId), 0, Math.max(0, limit - 1));
        });
    }

    public async listConsolidationCandidates(userId: string, until: number, limit: number): Promise<string[]> {
        return await this.withCircuit(async () => {
            // 整合 worker 用：取所有 reviewAt <= now 的 episode
            return await this.client.zrangebyscore(this.consolidationKey(userId), 0, until, "LIMIT", 0, limit);
        });
    }

    public async dropEpisode(userId: string, episodeId: string): Promise<void> {
        await this.withCircuit(async () => {
            // CONSOLIDATE / DISCARD 决策完毕后回收 Redis 占用
            const pipeline = this.client.pipeline();
            pipeline.del(this.episodeKey(userId, episodeId));
            pipeline.zrem(this.consolidationKey(userId), episodeId);
            await pipeline.exec();
        });
    }

    public async reinforceEpisode(userId: string, episodeId: string, ttlSeconds: number): Promise<boolean> {
        return await this.withCircuit(async () => {
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
        });
    }

    /** 原地改写 episode（dream rewrite 决策）：保留 id 与 createdAt，重写 text/concepts/importance。 */
    public async rewriteEpisode(
        userId: string,
        episodeId: string,
        patch: { text?: string; concepts?: string[]; importance?: number; metadata?: Record<string, unknown> },
    ): Promise<boolean> {
        return await this.withCircuit(async () => {
            const raw = await this.client.hgetall(this.episodeKey(userId, episodeId));
            if (!raw || Object.keys(raw).length === 0) return false;
            const existing = this.decodeEpisodeFields(episodeId, raw);
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
        });
    }

    public async touchConcepts(userId: string, concepts: string[]): Promise<void> {
        if (concepts.length === 0) {
            return;
        }
        await this.withCircuit(async () => {
            const now = Date.now();
            const args: (string | number)[] = [];
            for (const concept of concepts) {
                args.push(now, concept);
            }
            await this.client.zadd(this.activationKey(userId), ...args);
            // ZSET 也加 TTL，避免静默用户的热度榜永久占内存
            await this.client.expire(this.activationKey(userId), this.defaultTtlSeconds * 2);
        });
    }

    public async hotConcepts(userId: string, limit: number): Promise<string[]> {
        return await this.withCircuit(async () => {
            // 返回最近激活的 top N 概念（按时间戳倒序）
            return await this.client.zrevrange(this.activationKey(userId), 0, Math.max(0, limit - 1));
        });
    }

    private async withCircuit<T>(action: () => Promise<T>): Promise<T> {
        await this.connect();
        try {
            const result = await action();
            if (this.circuitState !== "closed") {
                this.closeCircuit();
            }
            return result;
        } catch (error) {
            this.tripCircuit(error);
            throw error;
        }
    }

    private ensureCircuitProbeAllowed(): void {
        if (this.circuitState !== "open") {
            return;
        }
        const now = Date.now();
        if (this.nextRetryAt !== undefined && now < this.nextRetryAt) {
            throw createStorageError(
                "redis-working-memory-circuit-open",
                "Redis working memory is temporarily unavailable; waiting for the next circuit probe",
            );
        }
    }

    private closeCircuit(): void {
        this.circuitState = "closed";
        this.failureCount = 0;
        this.lastError = undefined;
        this.lastRecoveredAt = Date.now();
        this.nextRetryAt = undefined;
    }

    private tripCircuit(error: unknown): void {
        this.circuitState = "open";
        this.failureCount = Math.min(10, this.failureCount + 1);
        this.lastError = describeError(error);
        this.nextRetryAt = Date.now() + Math.min(30000, Math.max(this.timeoutMs, 1000 * 2 ** Math.max(0, this.failureCount - 1)));
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

export function redisKeyPrefixForNamespace(namespace: string | undefined): string {
    const normalized = typeof namespace === "string" ? namespace.trim() : "";
    if (!normalized || normalized === "flyflor") {
        return "ff";
    }
    return encodeURIComponent(normalized);
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

function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as Error & { code?: string }).code;
        return code ? `${code}: ${error.message}` : error.message;
    }
    return String(error);
}
