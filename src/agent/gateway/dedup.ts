/**
 * 网关消息去重 / 幂等键（multi-replica safe）。
 *
 * 场景：
 *  - 同一 webhook 被上游重试（Slack、Telegram、企业微信都会按 5xx 重发）；
 *  - 多副本部署 + 负载均衡时同一消息分发到两个 replica；
 *  - 调试期间手动重放 webhook payload。
 *
 * 模型：
 *  - key = `${channel}:${message.id}`；
 *  - tryClaim(key) 第一次返回 "claimed"，并把空槽以 TTL 持久化；
 *  - 处理完成后调用 recordReply(key, reply) 把 GatewayReply 序列化进同一 key；
 *  - 重复请求看到 key 存在：
 *      - 仍在 in-flight（reply 为空）→ 返回 "in-flight"（调用方决定是否丢弃 / 等待）；
 *      - 已完成 → 返回 "duplicate" 带 cachedReply（调用方直接回 200/写回原文）。
 *
 * 实现：
 *  - InMemoryDedupStore：LRU + TTL，单进程兜底；
 *  - RedisDedupStore：基于 Redis-compatible `SET key value EX ttl NX`，多副本下天然 atomic。
 */

import type { GatewayReply } from "../../protocol/contracts/index.ts";

export type DedupClaim =
    | { state: "claimed"; key: string }
    | { state: "in-flight"; key: string }
    | { state: "duplicate"; key: string; cachedReply: GatewayReply };

export interface MessageDedupStore {
    /** 第一次尝试占据 key；如果已经存在返回 in-flight 或 duplicate。 */
    tryClaim(key: string): Promise<DedupClaim>;
    /** 处理成功后写回 reply（保留 TTL）；duplicate 状态再次出现时返回这条 reply。 */
    recordReply(key: string, reply: GatewayReply): Promise<void>;
    /** 处理失败时释放 key，允许下次重试时立即重入。 */
    release(key: string): Promise<void>;
}

export interface RedisDedupClient {
    del(key: string): Promise<unknown>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ex: "EX", ttlSeconds: number, mode: "NX" | "XX"): Promise<"OK" | null>;
}

export function buildDedupKey(channel: string, messageId: string): string {
    return `gw-dedup:${channel}:${messageId}`;
}

/** 单进程 LRU + TTL 实现（默认 60s）。 */
export class InMemoryDedupStore implements MessageDedupStore {
    private readonly entries = new Map<string, { expiresAt: number; reply?: GatewayReply }>();
    constructor(private readonly ttlMs: number = 60_000, private readonly maxEntries: number = 1024) {}

    async tryClaim(key: string): Promise<DedupClaim> {
        this.evictExpired();
        const existing = this.entries.get(key);
        if (existing && existing.expiresAt > Date.now()) {
            if (existing.reply) return { state: "duplicate", key, cachedReply: existing.reply };
            return { state: "in-flight", key };
        }
        this.entries.set(key, { expiresAt: Date.now() + this.ttlMs });
        this.enforceCapacity();
        return { state: "claimed", key };
    }

    async recordReply(key: string, reply: GatewayReply): Promise<void> {
        const existing = this.entries.get(key);
        const expiresAt = existing?.expiresAt ?? Date.now() + this.ttlMs;
        this.entries.set(key, { expiresAt, reply });
    }

    async release(key: string): Promise<void> {
        this.entries.delete(key);
    }

    private evictExpired(): void {
        const now = Date.now();
        for (const [k, v] of this.entries) {
            if (v.expiresAt <= now) this.entries.delete(k);
        }
    }

    private enforceCapacity(): void {
        while (this.entries.size > this.maxEntries) {
            const first = this.entries.keys().next();
            if (first.done) break;
            this.entries.delete(first.value);
        }
    }
}

/**
 * Redis 实现：用 `SET key "" EX ttl NX` 抢占 → 处理完 `SET key <reply> EX ttl XX`。
 * 不复用任何 memory component schema，独立 key 前缀避免 namespace 污染。
 */
export class RedisDedupStore implements MessageDedupStore {
    private readonly inflightMarker = "__inflight__";
    constructor(private readonly redis: RedisDedupClient, private readonly ttlSeconds: number = 60) {}

    async tryClaim(key: string): Promise<DedupClaim> {
        const ok = await this.redis.set(key, this.inflightMarker, "EX", this.ttlSeconds, "NX");
        if (ok === "OK") return { state: "claimed", key };
        const existing = await this.redis.get(key);
        if (existing === null || existing === this.inflightMarker) {
            return { state: "in-flight", key };
        }
        try {
            const cachedReply = JSON.parse(existing) as GatewayReply;
            return { state: "duplicate", key, cachedReply };
        } catch {
            // corrupt payload — treat as in-flight (caller should drop)
            return { state: "in-flight", key };
        }
    }

    async recordReply(key: string, reply: GatewayReply): Promise<void> {
        const payload = JSON.stringify(reply);
        // XX = only set if exists, preserving TTL implicitly via KEEPTTL when supported; fallback EX same ttl.
        await this.redis.set(key, payload, "EX", this.ttlSeconds, "XX");
    }

    async release(key: string): Promise<void> {
        await this.redis.del(key);
    }
}
