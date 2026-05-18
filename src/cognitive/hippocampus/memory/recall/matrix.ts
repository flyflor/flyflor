import type { MemoryMatrixConfig } from "../../../../config/index.ts";
import type { GatewayMessage, GatewayReply } from "../../../../protocol/contracts/index.ts";
import type { MemoryAction } from "../actions/index.ts";
import type { MemoryMatrixResult, MemoryWeights } from "../types.ts";

interface MatrixInput {
    action: MemoryAction;
    message: GatewayMessage;
    reply: GatewayReply;
    weights: MemoryWeights;
}

const ROWS = ["affect", "semantic", "residual", "evidence"];
const COLUMNS = ["stability", "salience", "utility", "risk"];

export class MemoryMatrixAggregator {
    private readonly lexical = new MemoryMatrixLexicalCodec();

    public constructor(private readonly config: MemoryMatrixConfig) {}

    public aggregate(input: MatrixInput): MemoryMatrixResult {
        const started = performance.now();
        const weights = input.weights;
        if (!this.config.enabled) {
            return disabledMatrix(weights, performance.now() - started);
        }
        const content = truncate(input.action.content, this.config.maxSourceChars);
        const source = truncate(`${input.message.text}\n${input.reply.text}`, this.config.maxSourceChars);
        const contentTokens = this.lexical.tokenize(content, this.config.maxTokens);
        const sourceTokens = this.lexical.tokenize(source, this.config.maxTokens * 2);
        const replyTokens = this.lexical.tokenize(input.reply.text, this.config.maxTokens);
        // Affect is accepted only from same-turn structured model weights.
        // No sentiment dictionary or text keyword can influence memory routing.
        const structuredAffect = clampSigned(weights.emotionalValence);
        const tfidfPeak = this.lexical.tfidfPeakScore(contentTokens, sourceTokens, replyTokens);
        const lexicalNovelty = clamp01(1 - overlapRatio(contentTokens, [...sourceTokens, ...replyTokens]));
        const uncertainty = clamp01(1 - weights.certainty * weights.confidence);
        const decayRisk = clamp01(1 - weights.durability);
        const contradictionRisk = clamp01(
            Math.max(0, -weights.emotionalValence) * 0.42 +
                uncertainty * 0.28 +
                weights.arousal * 0.18 +
                decayRisk * 0.12,
        );
        const reusePotential = clamp01(
            weights.actionability * 0.34 +
                weights.relevance * 0.3 +
                weights.durability * 0.24 +
                weights.confidence * 0.12,
        );
        const residualValue = clamp01(
            lexicalNovelty * 0.24 +
                uncertainty * 0.2 +
                reusePotential * 0.22 +
                contradictionRisk * 0.14 +
                decayRisk * 0.08 +
                tfidfPeak * 0.12,
        );
        const recallBoost = clamp01(
            weights.importance * 0.5 + reusePotential * 0.22 + residualValue * 0.18 + Math.abs(structuredAffect) * 0.1,
        );
        const reflectionPriority = clamp01(
            residualValue * 0.42 + contradictionRisk * 0.24 + uncertainty * 0.2 + decayRisk * 0.14,
        );
        const matrix = [
            [
                clamp01((weights.emotionalValence + 1) / 2),
                weights.arousal,
                weights.dominance,
                Math.abs(structuredAffect),
            ],
            [weights.durability, weights.relevance, weights.actionability, weights.certainty],
            [lexicalNovelty, uncertainty, reusePotential, contradictionRisk],
            [weights.recurrence, weights.sourceDiversity, weights.validationCount, weights.confidence],
        ].map((row) => row.map(clamp01));
        const aggregationMs = performance.now() - started;

        return {
            aggregate: {
                aggregationMs,
                baseImportance: weights.importance,
                importanceDelta: clampSigned(recallBoost - weights.importance),
                recallBoost,
                reflectionPriority,
                residualValue,
            },
            columns: COLUMNS,
            matrix,
            natural: {
                sentiment: structuredAffect,
                tfidfPeak,
                tokenCount: contentTokens.length,
                uniqueTokenRatio: uniqueRatio(contentTokens),
            },
            residual: {
                contradictionRisk,
                decayRisk,
                lexicalNovelty,
                reusePotential,
                uncertainty,
            },
            rows: ROWS,
            schemaVersion: 1,
        };
    }

    /**
     * Apply matrix aggregate values back to durable memory weights.
     *
     * This is intentionally owned by the matrix component because the exact
     * blend is part of the matrix contract, not a free-floating memory helper.
     */
    public applyImpact(weights: MemoryWeights, matrix: MemoryMatrixResult): MemoryWeights {
        return {
            ...weights,
            importance: clamp01(
                weights.importance * 0.88 + matrix.aggregate.recallBoost * 0.08 + matrix.aggregate.residualValue * 0.04,
            ),
        };
    }

    public recallBoostFromMetadata(metadata: Record<string, unknown> | undefined): number {
        const matrix = metadata?.matrix;
        if (!isRecord(matrix)) {
            return 0;
        }
        const aggregate = matrix.aggregate;
        if (!isRecord(aggregate)) {
            return 0;
        }
        const value = aggregate.recallBoost;
        return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : 0;
    }
}

/**
 * Local lexical metrics for MemoryMatrixAggregator.
 *
 * This intentionally replaces the previous `natural` dependency: the memory
 * matrix only needs resource-style token counts, novelty and TF-IDF-like peak
 * scores. Keeping it local avoids bringing sentiment lexicons, Redis/Mongo/PG
 * transitive dependencies, and compile-time package assets into the runtime.
 */
class MemoryMatrixLexicalCodec {
    public tokenize(text: string, maxTokens: number): string[] {
        const normalized = text.toLowerCase();
        const unicodeTokens = normalized.split(/[^\p{L}\p{N}_-]+/u);
        const cjkTokens = this.cjkBigrams(normalized);
        return [...unicodeTokens, ...cjkTokens]
            .map((token) => token.trim())
            .filter((token) => token.length >= 2 && token.length <= 64)
            .slice(0, Math.max(0, maxTokens));
    }

    public tfidfPeakScore(contentTokens: string[], sourceTokens: string[], replyTokens: string[]): number {
        if (contentTokens.length === 0) {
            return 0;
        }
        const documents = [contentTokens, sourceTokens, replyTokens];
        const contentFrequency = this.termFrequency(contentTokens);
        let peak = 0;
        for (const [token, count] of contentFrequency.entries()) {
            const documentFrequency = documents.filter((document) => document.includes(token)).length;
            const inverseDocumentFrequency = Math.log((documents.length + 1) / (documentFrequency + 1)) + 1;
            peak = Math.max(peak, count * inverseDocumentFrequency);
        }
        return clamp01(Math.log1p(peak) / 3);
    }

    private cjkBigrams(text: string): string[] {
        const chars = [...text].filter((char) => /\p{Script=Han}/u.test(char));
        const tokens: string[] = [];
        for (let index = 0; index < chars.length - 1; index += 1) {
            tokens.push(`${chars[index]}${chars[index + 1]}`);
        }
        return tokens;
    }

    private termFrequency(tokens: string[]): Map<string, number> {
        const frequency = new Map<string, number>();
        for (const token of tokens) {
            frequency.set(token, (frequency.get(token) ?? 0) + 1);
        }
        return frequency;
    }
}

export function applyMatrixImpact(weights: MemoryWeights, matrix: MemoryMatrixResult): MemoryWeights {
    return DEFAULT_MATRIX_AGGREGATOR.applyImpact(weights, matrix);
}

export function recallBoostFromMetadata(metadata: Record<string, unknown> | undefined): number {
    return DEFAULT_MATRIX_AGGREGATOR.recallBoostFromMetadata(metadata);
}

const DEFAULT_MATRIX_AGGREGATOR = new MemoryMatrixAggregator({
    enabled: true,
    maxSourceChars: 0,
    maxTokens: 0,
    naturalSentiment: false,
});

function disabledMatrix(weights: MemoryWeights, aggregationMs: number): MemoryMatrixResult {
    return {
        aggregate: {
            aggregationMs,
            baseImportance: weights.importance,
            importanceDelta: 0,
            recallBoost: weights.importance,
            reflectionPriority: 0,
            residualValue: 0,
        },
        columns: COLUMNS,
        matrix: [
            [clamp01((weights.emotionalValence + 1) / 2), weights.arousal, weights.dominance, 0],
            [weights.durability, weights.relevance, weights.actionability, weights.certainty],
            [0, 0, 0, 0],
            [weights.recurrence, weights.sourceDiversity, weights.validationCount, weights.confidence],
        ].map((row) => row.map(clamp01)),
        natural: {
            sentiment: 0,
            tfidfPeak: 0,
            tokenCount: 0,
            uniqueTokenRatio: 0,
        },
        residual: {
            contradictionRisk: 0,
            decayRisk: 0,
            lexicalNovelty: 0,
            reusePotential: 0,
            uncertainty: 0,
        },
        rows: ROWS,
        schemaVersion: 1,
    };
}

function overlapRatio(left: string[], right: string[]): number {
    if (left.length === 0 || right.length === 0) {
        return 0;
    }
    const rightSet = new Set(right);
    const hits = left.filter((token) => rightSet.has(token)).length;
    return clamp01(hits / left.length);
}

function uniqueRatio(tokens: string[]): number {
    if (tokens.length === 0) {
        return 0;
    }
    return clamp01(new Set(tokens).size / tokens.length);
}

function truncate(value: string, maxChars: number): string {
    return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(-1, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
