/**
 * 简单 LRU 缓存：用于长期图 ANN 查询结果短期复用。
 *
 * 设计目标：
 * - **零依赖**（编译进 bun 二进制无 native 风险）；
 * - O(1) get/set，使用 Map 的插入顺序作为 LRU 列表；
 * - 每条记录带 expiresAt（ms 时间戳），支持 TTL 过期；
 * - 不做后台清理；过期项在下一次 get 时被发现并移除（lazy）。
 *
 * 不在此处做语义计算，调用方负责拼出 cache key。
 */
export interface LruOptions {
    maxSize: number;
    ttlMs: number;
}

interface Entry<V> {
    value: V;
    expiresAt: number;
}

export class LruCache<V> {
    private readonly map = new Map<string, Entry<V>>();
    private hits = 0;
    private misses = 0;

    public constructor(private readonly options: LruOptions) {}

    public get(key: string, nowMs = Date.now()): V | undefined {
        const entry = this.map.get(key);
        if (!entry) {
            this.misses += 1;
            return undefined;
        }
        if (entry.expiresAt <= nowMs) {
            this.map.delete(key);
            this.misses += 1;
            return undefined;
        }
        // refresh LRU order
        this.map.delete(key);
        this.map.set(key, entry);
        this.hits += 1;
        return entry.value;
    }

    public set(key: string, value: V, nowMs = Date.now()): void {
        if (this.options.maxSize <= 0) return;
        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.options.maxSize) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined) {
                this.map.delete(oldest);
            }
        }
        this.map.set(key, { value, expiresAt: nowMs + this.options.ttlMs });
    }

    public delete(key: string): boolean {
        return this.map.delete(key);
    }

    public clear(): void {
        this.map.clear();
        this.hits = 0;
        this.misses = 0;
    }

    public get size(): number {
        return this.map.size;
    }

    public stats(): { hits: number; misses: number; hitRate: number; size: number } {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
            size: this.map.size,
        };
    }
}
