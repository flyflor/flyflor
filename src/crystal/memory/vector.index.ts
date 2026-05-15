import type { CrystalGem, CrystalRecallRequest } from "../../protocol/contracts/index.ts";

export const DEFAULT_CRYSTAL_VECTOR_DIMENSIONS = 384;

export interface CrystalVectorIndexEntry {
    gem: CrystalGem;
    embedding: number[];
    searchableText: string;
}

export class FlatBruteForceVectorIndex {
    private readonly entries = new Map<string, CrystalVectorIndexEntry>();

    public constructor(private readonly dimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS) {}

    public hydrate(gems: CrystalGem[]): void {
        this.entries.clear();
        for (const gem of gems) {
            this.upsert(gem);
        }
    }

    public upsert(gem: CrystalGem): void {
        this.entries.set(gem.id, {
            gem,
            embedding: embedCrystalText(toCrystalSearchText(gem), this.dimensions),
            searchableText: toCrystalSearchText(gem),
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
        const queryEmbedding = embedCrystalText(buildQueryText(request), this.dimensions);
        const querySymbols = normalizeSymbols(request.symbols ?? []);
        const buckets = new Set(request.buckets ?? []);
        return [...this.entries.values()]
            .map((entry) => {
                const gem = entry.gem;
                const bucketMatch = buckets.size > 0 && buckets.has(gem.bucket) ? 1 : 0;
                const symbolOverlap = overlapRatio(querySymbols, gem.symbols);
                const textSimilarity = cosine(queryEmbedding, entry.embedding);
                const freshness = freshnessScore(gem.updatedAt);
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
    return [gem.bucket, gem.title, gem.method, ...gem.symbols].filter(Boolean).join(" ");
}

export function buildQueryText(request: CrystalRecallRequest): string {
    return [request.query, ...(request.symbols ?? []), ...(request.buckets ?? [])].filter(Boolean).join(" ");
}

export function embedCrystalText(text: string, dimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS): number[] {
    const vector = new Array(dimensions).fill(0);
    const tokens = tokenizeCrystalText(text);
    if (tokens.length === 0) {
        return vector;
    }
    for (const token of tokens) {
        const slot = hashToken(token) % dimensions;
        vector[slot] += 1;
    }
    const norm = Math.hypot(...vector);
    if (norm === 0) {
        return vector;
    }
    return vector.map((value) => value / norm);
}

function tokenizeCrystalText(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}

function hashToken(token: string): number {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
        hash ^= token.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function normalizeSymbols(symbols: string[]): string[] {
    return [...new Set(symbols.map((symbol) => symbol.toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
}

function overlapRatio(left: string[], right: string[]): number {
    if (left.length === 0 || right.length === 0) {
        return 0;
    }
    const rightSet = new Set(right.map((symbol) => symbol.toLowerCase()));
    const hits = left.filter((symbol) => rightSet.has(symbol)).length;
    return hits / Math.max(left.length, right.length);
}

function cosine(left: number[], right: number[]): number {
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

function freshnessScore(updatedAt: string): number {
    const timestamp = Date.parse(updatedAt);
    if (!Number.isFinite(timestamp)) {
        return 0;
    }
    const ageMs = Math.max(0, Date.now() - timestamp);
    const ageDays = ageMs / 86_400_000;
    return 1 / (1 + ageDays);
}
