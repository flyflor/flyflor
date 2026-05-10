import type { MemoryMatrixConfig } from "../../config/index.ts";
import type { GatewayMessage, GatewayReply } from "../../protocol/contracts/index.ts";
import type { MemoryAction } from "./actions.ts";
import type { MemoryMatrixResult, MemoryWeights } from "./types.ts";
import SentimentAnalyzer from "natural/lib/natural/sentiment/SentimentAnalyzer.js";
import PorterStemmer from "natural/lib/natural/stemmers/porter_stemmer.js";
import TfIdf from "natural/lib/natural/tfidf/tfidf.js";
import { WordTokenizer } from "natural/lib/natural/tokenizers/regexp_tokenizer.js";

interface MatrixInput {
    action: MemoryAction;
    message: GatewayMessage;
    reply: GatewayReply;
    weights: MemoryWeights;
}

const ROWS = ["affect", "semantic", "residual", "evidence"];
const COLUMNS = ["stability", "salience", "utility", "risk"];
const tokenizer = new WordTokenizer();
const sentiment = new SentimentAnalyzer("English", PorterStemmer, "afinn");

export class MemoryMatrixAggregator {
    constructor(private readonly config: MemoryMatrixConfig) {}

    aggregate(input: MatrixInput): MemoryMatrixResult {
        const started = performance.now();
        const weights = input.weights;
        if (!this.config.enabled) {
            return disabledMatrix(weights, performance.now() - started);
        }
        const content = truncate(input.action.content, this.config.maxSourceChars);
        const source = truncate(`${input.message.text}\n${input.reply.text}`, this.config.maxSourceChars);
        const contentTokens = tokenize(content, this.config.maxTokens);
        const sourceTokens = tokenize(source, this.config.maxTokens * 2);
        const replyTokens = tokenize(input.reply.text, this.config.maxTokens);
        const naturalSentiment = this.config.naturalSentiment ? sentimentScore(contentTokens) : 0;
        const tfidfPeak = tfidfPeakScore(contentTokens, sourceTokens, replyTokens);
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
            weights.importance * 0.5 + reusePotential * 0.22 + residualValue * 0.18 + Math.abs(naturalSentiment) * 0.1,
        );
        const reflectionPriority = clamp01(
            residualValue * 0.42 + contradictionRisk * 0.24 + uncertainty * 0.2 + decayRisk * 0.14,
        );
        const matrix = [
            [
                clamp01((weights.emotionalValence + 1) / 2),
                weights.arousal,
                weights.dominance,
                Math.abs(naturalSentiment),
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
                sentiment: naturalSentiment,
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
}

export function applyMatrixImpact(weights: MemoryWeights, matrix: MemoryMatrixResult): MemoryWeights {
    return {
        ...weights,
        importance: clamp01(
            weights.importance * 0.88 + matrix.aggregate.recallBoost * 0.08 + matrix.aggregate.residualValue * 0.04,
        ),
    };
}

export function recallBoostFromMetadata(metadata: Record<string, unknown> | undefined): number {
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

function tokenize(text: string, maxTokens: number): string[] {
    const normalized = text.toLowerCase();
    const naturalTokens = tokenizer.tokenize(normalized);
    const unicodeTokens = normalized.split(/[^\p{L}\p{N}_-]+/u);
    const cjkTokens = cjkBigrams(normalized);
    return [...naturalTokens, ...unicodeTokens, ...cjkTokens]
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && token.length <= 64)
        .slice(0, Math.max(0, maxTokens));
}

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

function cjkBigrams(text: string): string[] {
    const chars = [...text].filter((char) => /\p{Script=Han}/u.test(char));
    const tokens: string[] = [];
    for (let index = 0; index < chars.length - 1; index += 1) {
        tokens.push(`${chars[index]}${chars[index + 1]}`);
    }
    return tokens;
}

function sentimentScore(tokens: string[]): number {
    const latinTokens = tokens.filter((token) => /[a-z]/u.test(token));
    if (latinTokens.length === 0) {
        return 0;
    }
    return clampSigned(sentiment.getSentiment(latinTokens) / 5);
}

function tfidfPeakScore(contentTokens: string[], sourceTokens: string[], replyTokens: string[]): number {
    if (contentTokens.length === 0) {
        return 0;
    }
    const tfidf = new TfIdf();
    tfidf.addDocument(contentTokens);
    tfidf.addDocument(sourceTokens);
    tfidf.addDocument(replyTokens);
    const peak = tfidf.listTerms(0)[0]?.tfidf ?? 0;
    return clamp01(Math.log1p(peak) / 3);
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
