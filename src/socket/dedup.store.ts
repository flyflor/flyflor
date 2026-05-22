import type { GatewayReply } from "../protocol/contracts/index.ts";

export type DedupClaim =
    | { state: "claimed"; key: string }
    | { state: "in-flight"; key: string }
    | { state: "duplicate"; key: string; cachedReply: GatewayReply };

export interface MessageDedupStore {
    tryClaim(key: string): Promise<DedupClaim>;
    recordReply(key: string, reply: GatewayReply): Promise<void>;
    release(key: string): Promise<void>;
}

export function buildDedupKey(channel: string, messageId: string): string {
    return `gw-dedup:${channel}:${messageId}`;
}

export class InMemoryDedupStore implements MessageDedupStore {
    private readonly entries = new Map<string, { expiresAt: number; reply?: GatewayReply }>();

    public constructor(private readonly ttlMs: number = 60_000, private readonly maxEntries: number = 1024) {}

    public async tryClaim(key: string): Promise<DedupClaim> {
        this.evictExpired();
        const existing = this.entries.get(key);
        if (existing && existing.expiresAt > Date.now()) {
            if (existing.reply) {
                return { state: "duplicate", key, cachedReply: existing.reply };
            }
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
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
            }
        }
    }

    private enforceCapacity(): void {
        while (this.entries.size > this.maxEntries) {
            const first = this.entries.keys().next();
            if (first.done) {
                break;
            }
            this.entries.delete(first.value);
        }
    }
}
