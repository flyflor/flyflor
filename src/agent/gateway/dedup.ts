/**
 * 网关消息去重 / 幂等键。
 *
 * 场景：
 *  - 同一 webhook 被上游重试（Slack、Telegram、企业微信都会按 5xx 重发）；
 *  - 单进程网关中同一消息重复进入 dispatcher；
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
 *  - InMemoryDedupStore：LRU + TTL，当前默认实现；
 *  - 多副本共享去重后续必须新增独立 Component 实现，不能复用记忆后端或旧 Redis 兼容适配器。
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

export function buildDedupKey(channel: string, messageId: string): string {
    return `gw-dedup:${channel}:${messageId}`;
}

/** 单进程 LRU + TTL 实现（默认 60s）。 */
export class InMemoryDedupStore implements MessageDedupStore {
    private readonly entries = new Map<string, { expiresAt: number; reply?: GatewayReply }>();
    public constructor(private readonly ttlMs: number = 60_000, private readonly maxEntries: number = 1024) {}

    public async tryClaim(key: string): Promise<DedupClaim> {
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

    public async recordReply(key: string, reply: GatewayReply): Promise<void> {
        const existing = this.entries.get(key);
        const expiresAt = existing?.expiresAt ?? Date.now() + this.ttlMs;
        this.entries.set(key, { expiresAt, reply });
    }

    public async release(key: string): Promise<void> {
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
