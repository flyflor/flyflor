export interface SocketReadCacheStats {
    entries: number;
    hits: number;
    misses: number;
    invalidations: number;
    ttlMs: number;
}

interface SocketReadCacheEntry<TValue> {
    expiresAt: number;
    value: TValue;
}

export class SocketReadCache<TValue> {
    private readonly entries = new Map<string, SocketReadCacheEntry<TValue>>();
    private hits = 0;
    private invalidations = 0;
    private misses = 0;

    public constructor(
        private readonly options: {
            maxEntries: number;
            ttlMs: number;
        } = { maxEntries: 128, ttlMs: 1500 },
    ) {}

    public get(key: string, nowMs = Date.now()): TValue | undefined {
        const entry = this.entries.get(key);
        if (!entry) {
            this.misses += 1;
            return undefined;
        }
        if (entry.expiresAt <= nowMs) {
            this.entries.delete(key);
            this.misses += 1;
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        this.hits += 1;
        return entry.value;
    }

    public set(key: string, value: TValue, nowMs = Date.now()): void {
        if (this.options.maxEntries <= 0) return;
        if (this.entries.has(key)) {
            this.entries.delete(key);
        } else if (this.entries.size >= this.options.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
        }
        this.entries.set(key, { expiresAt: nowMs + this.options.ttlMs, value });
    }

    public clear(): void {
        if (this.entries.size > 0) {
            this.invalidations += 1;
        }
        this.entries.clear();
    }

    public stats(): SocketReadCacheStats {
        return {
            entries: this.entries.size,
            hits: this.hits,
            misses: this.misses,
            invalidations: this.invalidations,
            ttlMs: this.options.ttlMs,
        };
    }
}
