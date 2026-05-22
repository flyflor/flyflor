import type { CodenameRecord, ScopeRecord } from "../../../../protocol/contracts/index.ts";

export const DEFAULT_SCOPE_VECTOR_DIMENSIONS = 384;

export interface ScopeVectorCodecInput {
    scope: ScopeRecord;
    codename?: CodenameRecord | null;
    summary?: string;
    symbols?: string[];
}

/**
 * Deterministic vector codec for scope graph lookup.
 *
 * Scope Vector owns indexing math for durable scope identities. It never uses
 * text rules to decide user intent; callers provide explicit scope/codename
 * records and structured query text.
 */
export class ScopeVectorCodec {
    public toScopeSearchText(input: ScopeVectorCodecInput): string {
        return [
            input.scope.id,
            input.scope.title,
            input.scope.goal,
            input.scope.projectDir,
            input.codename?.id,
            input.codename?.name,
            input.codename?.description,
            input.summary,
            ...(input.symbols ?? []),
        ]
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .join(" ");
    }

    public embedScopeText(input: ScopeVectorCodecInput, dimensions = DEFAULT_SCOPE_VECTOR_DIMENSIONS): number[] {
        return this.embedText(this.toScopeSearchText(input), dimensions);
    }

    public embedText(text: string, dimensions = DEFAULT_SCOPE_VECTOR_DIMENSIONS): number[] {
        const vector = new Array<number>(dimensions).fill(0);
        const tokens = this.tokenize(text);
        if (tokens.length === 0) return vector;
        for (const token of tokens) {
            const hash = this.hashToken(token);
            const slot = hash % dimensions;
            vector[slot] = (vector[slot] ?? 0) + (hash % 2 === 0 ? 1 : -1);
        }
        const norm = Math.hypot(...vector);
        return norm === 0 ? vector : vector.map((value) => value / norm);
    }

    public normalizeSymbols(values: string[]): string[] {
        return [
            ...new Set(
                values
                    .map((value) => value.toLowerCase().replace(/\s+/g, "-").trim())
                    .filter((value) => value.length > 0),
            ),
        ].slice(0, 64);
    }

    public symbolOverlap(left: string[], right: string[]): number {
        if (left.length === 0 || right.length === 0) return 0;
        const rightSet = new Set(right);
        const hits = left.filter((token) => rightSet.has(token)).length;
        return hits / Math.max(left.length, right.length);
    }

    public cosine(left: number[], right: number[]): number {
        if (left.length === 0 || right.length === 0) return 0;
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
        if (leftNorm === 0 || rightNorm === 0) return 0;
        return dot / Math.sqrt(leftNorm * rightNorm);
    }

    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .split(/[^\p{L}\p{N}_-]+/u)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2 && token.length <= 64)
            .slice(0, 512);
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

export const scopeVectorCodec = new ScopeVectorCodec();
