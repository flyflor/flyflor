import type { CrystalGem, CrystalRecallRequest } from "../../protocol/contracts/index.ts";

export const DEFAULT_CRYSTAL_VECTOR_DIMENSIONS = 384;

export interface CrystalVectorIndexEntry {
    gem: CrystalGem;
    embedding: number[];
    searchableText: string;
}

/**
 * Deterministic vector codec for local crystal recall.
 *
 * It owns tokenization, hashing and scoring math. Callers provide already
 * structured gems/requests; this layer never infers business intent from text.
 */
export class CrystalVectorCodec {
    public toCrystalSearchText(gem: CrystalGem): string {
        return [gem.bucket, gem.title, gem.method, ...gem.symbols].filter(Boolean).join(" ");
    }

    public buildQueryText(request: CrystalRecallRequest): string {
        return [request.query, ...(request.symbols ?? []), ...(request.buckets ?? [])].filter(Boolean).join(" ");
    }

    public embedCrystalText(text: string, dimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS): number[] {
        const vector = new Array(dimensions).fill(0);
        const tokens = this.tokenizeCrystalText(text);
        if (tokens.length === 0) {
            return vector;
        }
        for (const token of tokens) {
            const slot = this.hashToken(token) % dimensions;
            vector[slot] += 1;
        }
        const norm = Math.hypot(...vector);
        if (norm === 0) {
            return vector;
        }
        return vector.map((value) => value / norm);
    }

    public normalizeSymbols(symbols: string[]): string[] {
        return [...new Set(symbols.map((symbol) => symbol.toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
    }

    public overlapRatio(left: string[], right: string[]): number {
        if (left.length === 0 || right.length === 0) {
            return 0;
        }
        const rightSet = new Set(right.map((symbol) => symbol.toLowerCase()));
        const hits = left.filter((symbol) => rightSet.has(symbol)).length;
        return hits / Math.max(left.length, right.length);
    }

    public cosine(left: number[], right: number[]): number {
        if (left.length === 0 || right.length === 0) {
            return 0;
        }
        const length = Math.max(left.length, right.length);
        let dot = 0;
        let leftNorm = 0;
        let rightNorm = 0;
        for (let index = 0; index < length; index += 1) {
            const a = left[index] ?? 0;
            const b = right[index] ?? 0;
            dot += a * b;
            leftNorm += a * a;
            rightNorm += b * b;
        }
        if (leftNorm === 0 || rightNorm === 0) {
            return 0;
        }
        return dot / Math.sqrt(leftNorm * rightNorm);
    }

    public freshnessScore(updatedAt: string): number {
        const timestamp = Date.parse(updatedAt);
        if (!Number.isFinite(timestamp)) {
            return 0;
        }
        const ageMs = Math.max(0, Date.now() - timestamp);
        const ageDays = ageMs / 86_400_000;
        return 1 / (1 + ageDays);
    }

    private tokenizeCrystalText(text: string): string[] {
        return text
            .toLowerCase()
            .split(/[^\p{L}\p{N}_-]+/u)
            .map((token) => token.trim())
            .filter((token) => token.length > 0);
    }

    private hashToken(token: string): number {
        let hash = 2166136261;
        for (let index = 0; index < token.length; index += 1) {
            hash ^= token.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }
}

export const crystalVectorCodec = new CrystalVectorCodec();

export class FlatBruteForceVectorIndex {
    private readonly entries = new Map<string, CrystalVectorIndexEntry>();

    public constructor(
        private readonly dimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS,
        private readonly codec = crystalVectorCodec,
    ) {}

    public hydrate(gems: CrystalGem[]): void {
        this.entries.clear();
        for (const gem of gems) {
            this.upsert(gem);
        }
    }

    public upsert(gem: CrystalGem): void {
        const searchableText = this.codec.toCrystalSearchText(gem);
        this.entries.set(gem.id, {
            gem,
            embedding: this.codec.embedCrystalText(searchableText, this.dimensions),
            searchableText,
        });
    }

    public remove(id: string): void {
        this.entries.delete(id);
    }

    public find(id: string): CrystalGem | undefined {
        return this.entries.get(id)?.gem;
    }

    public list(): CrystalGem[] {
        return [...this.entries.values()].map((entry) => entry.gem);
    }

    public search(request: CrystalRecallRequest, limit: number): CrystalGem[] {
        if (limit <= 0 || this.entries.size === 0) {
            return [];
        }
        const queryEmbedding = this.codec.embedCrystalText(this.codec.buildQueryText(request), this.dimensions);
        const querySymbols = this.codec.normalizeSymbols(request.symbols ?? []);
        const buckets = new Set(request.buckets ?? []);
        return [...this.entries.values()]
            .map((entry) => {
                const gem = entry.gem;
                const bucketMatch = buckets.size > 0 && buckets.has(gem.bucket) ? 1 : 0;
                const symbolOverlap = this.codec.overlapRatio(querySymbols, gem.symbols);
                const textSimilarity = this.codec.cosine(queryEmbedding, entry.embedding);
                const freshness = this.codec.freshnessScore(gem.updatedAt);
                const score =
                    textSimilarity * 0.72 +
                    symbolOverlap * 0.18 +
                    bucketMatch * 0.08 +
                    freshness * 0.02;
                return { gem, score, bucketMatch, symbolOverlap, textSimilarity, freshness };
            })
            .filter((entry) => entry.score > 0)
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                if (right.bucketMatch !== left.bucketMatch) return right.bucketMatch - left.bucketMatch;
                if (right.symbolOverlap !== left.symbolOverlap) return right.symbolOverlap - left.symbolOverlap;
                if (right.freshness !== left.freshness) return right.freshness - left.freshness;
                return right.gem.support - left.gem.support;
            })
            .slice(0, limit)
            .map((entry) => entry.gem);
    }
}

export function toCrystalSearchText(gem: CrystalGem): string {
    return crystalVectorCodec.toCrystalSearchText(gem);
}

export function buildQueryText(request: CrystalRecallRequest): string {
    return crystalVectorCodec.buildQueryText(request);
}

export function embedCrystalText(text: string, dimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS): number[] {
    return crystalVectorCodec.embedCrystalText(text, dimensions);
}
