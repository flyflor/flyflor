import type { MemoryAnalyzerConfig } from "../../config/index.ts";
import type { MemorySignalAnalysis, MemoryWeights } from "./types.ts";

type LexiconEntry = {
    arousal?: number;
    certainty?: number;
    commitment?: number;
    dominance?: number;
    durability?: number;
    relevance?: number;
    valence?: number;
};

const TOKEN_MIN_LENGTH = 2;
const TOKEN_MAX_LENGTH = 64;

const STOPWORDS = new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "but",
    "for",
    "from",
    "have",
    "into",
    "that",
    "the",
    "this",
    "with",
    "你",
    "我",
    "我们",
    "你们",
    "他们",
    "这个",
    "那个",
    "然后",
    "就是",
    "进行",
    "需要",
]);

const SIGNAL_LEXICON: Record<string, LexiconEntry> = {
    always: { certainty: 0.9, commitment: 0.8, durability: 0.8 },
    avoid: { commitment: 0.75, dominance: 0.65, durability: 0.7 },
    certain: { certainty: 0.9 },
    decide: { commitment: 0.7, dominance: 0.7, durability: 0.65 },
    definitely: { certainty: 0.95, dominance: 0.65 },
    hate: { arousal: 0.8, valence: -0.8 },
    important: { arousal: 0.65, relevance: 0.8 },
    must: { certainty: 0.9, commitment: 0.9, dominance: 0.75 },
    prefer: { commitment: 0.75, durability: 0.7, relevance: 0.7 },
    should: { certainty: 0.65, commitment: 0.55 },
    stable: { durability: 0.75 },
    unsure: { certainty: -0.55 },
    wrong: { arousal: 0.7, valence: -0.7 },
    一定: { certainty: 0.95, commitment: 0.9, dominance: 0.75 },
    不要: { commitment: 0.85, dominance: 0.7, durability: 0.75 },
    不确定: { certainty: -0.65 },
    不能: { commitment: 0.85, dominance: 0.7 },
    严格: { certainty: 0.85, commitment: 0.75, dominance: 0.7 },
    以后: { durability: 0.8, commitment: 0.7 },
    保持: { durability: 0.75, commitment: 0.7 },
    偏好: { durability: 0.75, relevance: 0.7 },
    决定: { commitment: 0.75, dominance: 0.7, durability: 0.65 },
    准确: { relevance: 0.65, valence: 0.35 },
    喜欢: { durability: 0.65, valence: 0.65 },
    固定: { durability: 0.85, certainty: 0.75 },
    必须: { certainty: 0.95, commitment: 0.95, dominance: 0.8 },
    总是: { certainty: 0.85, durability: 0.8 },
    讨厌: { arousal: 0.8, valence: -0.8 },
    重要: { arousal: 0.7, relevance: 0.85 },
    错误: { arousal: 0.65, valence: -0.65 },
};

const DOMAIN_LEXICON = new Set([
    "agent",
    "bun",
    "channel",
    "config",
    "docker",
    "gateway",
    "memory",
    "mcp",
    "provider",
    "qdrant",
    "sandbox",
    "session",
    "sqlite",
    "typescript",
    "worker",
    "二进制",
    "反思",
    "向量",
    "多语言",
    "情绪",
    "方法论",
    "智能体",
    "模型",
    "沙箱",
    "空间记忆",
    "记忆",
    "配置",
]);

export class MemorySignalAnalyzer {
    constructor(private readonly config: MemoryAnalyzerConfig) {}

    analyze(text: string, defaults: MemoryWeights): MemorySignalAnalysis | undefined {
        const normalized = normalizeText(text);
        if (!this.config.enabled || normalized.length < this.config.minimumTextChars) {
            return undefined;
        }

        const language = detectLanguage(normalized);
        const sentences = splitSentences(normalized, language);
        const scoredSentences = sentences.map((sentence) => scoreSentence(sentence, language));
        const selected = scoredSentences.toSorted((left, right) => right.score - left.score)[0];
        if (!selected || selected.text.length < this.config.minimumTextChars) {
            return undefined;
        }

        const tokens = tokenize(normalized, language);
        const keyphrases = extractKeyphrases(tokens, normalized, this.config.keyphraseLimit);
        const aggregate = aggregateSignals(tokens, normalized);
        const affect = {
            arousal: clamp01(defaults.arousal * 0.35 + aggregate.arousal * 0.65),
            dominance: clamp01(defaults.dominance * 0.35 + aggregate.dominance * 0.65),
            valence: clampSigned(defaults.emotionalValence * 0.25 + aggregate.valence * 0.75),
        };
        const signals = {
            actionability: clamp01(defaults.actionability * 0.3 + selected.actionability * 0.7),
            certainty: clamp01(defaults.certainty * 0.35 + aggregate.certainty * 0.65),
            commitment: clamp01(aggregate.commitment),
            durability: clamp01(defaults.durability * 0.35 + aggregate.durability * 0.65),
            novelty: 0.5,
            relevance: clamp01(defaults.relevance * 0.3 + aggregate.relevance * 0.7),
        };
        const candidateScore = clamp01(
            signals.certainty * 0.18 +
                signals.commitment * 0.18 +
                signals.durability * 0.2 +
                signals.actionability * 0.16 +
                signals.relevance * 0.14 +
                signals.novelty * 0.08 +
                affect.arousal * 0.06,
        );

        return {
            language,
            candidateScore,
            keyphrases,
            selectedText: selected.text,
            affect,
            signals,
        };
    }
}

export function weightsFromAnalysis(defaults: MemoryWeights, analysis: MemorySignalAnalysis): MemoryWeights {
    return {
        ...defaults,
        actionability: analysis.signals.actionability,
        arousal: analysis.affect.arousal,
        certainty: analysis.signals.certainty,
        confidence: analysis.signals.certainty,
        durability: analysis.signals.durability,
        dominance: analysis.affect.dominance,
        emotionalValence: analysis.affect.valence,
        importance: clamp01(analysis.candidateScore * 0.7 + analysis.affect.arousal * 0.15 + analysis.signals.commitment * 0.15),
        relevance: analysis.signals.relevance,
    };
}

function normalizeText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function detectLanguage(text: string): string {
    const cjk = countMatches(text, /[\u3400-\u4dbf\u4e00-\u9fff]/gu);
    const latin = countMatches(text, /[a-z]/giu);
    if (cjk > latin * 0.4) {
        return "zh";
    }
    return "und";
}

function splitSentences(text: string, language: string): string[] {
    const segmenter = createSegmenter(language, "sentence");
    if (segmenter) {
        return [...segmenter.segment(text)]
            .map((segment) => segment.segment.trim())
            .filter(Boolean);
    }
    return text.split(/(?<=[。！？.!?])\s*/u).filter(Boolean);
}

function tokenize(text: string, language: string): string[] {
    const codeTokens = text.match(/[A-Za-z][A-Za-z0-9_-]{1,63}|[\p{N}_-]{2,64}/gu) ?? [];
    const segmenter = createSegmenter(language, "word");
    const words = segmenter
        ? [...segmenter.segment(text)]
              .filter((segment) => segment.isWordLike)
              .map((segment) => segment.segment)
        : text.split(/[^\p{L}\p{N}_-]+/u);
    return [...words, ...codeTokens]
        .map((token) => token.toLowerCase().trim())
        .filter((token) => token.length >= TOKEN_MIN_LENGTH && token.length <= TOKEN_MAX_LENGTH && !STOPWORDS.has(token));
}

function scoreSentence(text: string, language: string): { actionability: number; score: number; text: string } {
    const tokens = tokenize(text, language);
    const aggregate = aggregateSignals(tokens, text);
    const actionability = clamp01((aggregate.commitment + aggregate.dominance + aggregate.relevance) / 3);
    const score = clamp01(
        aggregate.certainty * 0.18 +
            aggregate.commitment * 0.25 +
            aggregate.durability * 0.22 +
            aggregate.relevance * 0.2 +
            actionability * 0.15,
    );
    return { actionability, score, text };
}

function aggregateSignals(tokens: string[], text: string): Required<LexiconEntry> {
    const total: Required<LexiconEntry> = {
        arousal: punctuationArousal(text),
        certainty: 0.5,
        commitment: 0,
        dominance: 0.5,
        durability: 0.25,
        relevance: domainRelevance(tokens),
        valence: 0,
    };
    let hits = 0;
    for (const token of tokens) {
        const entry = SIGNAL_LEXICON[token];
        if (!entry) {
            continue;
        }
        hits += 1;
        total.arousal += entry.arousal ?? 0;
        total.certainty += entry.certainty ?? 0;
        total.commitment += entry.commitment ?? 0;
        total.dominance += entry.dominance ?? 0;
        total.durability += entry.durability ?? 0;
        total.relevance += entry.relevance ?? 0;
        total.valence += entry.valence ?? 0;
    }

    const divisor = Math.max(1, hits);
    return {
        arousal: clamp01(total.arousal / divisor),
        certainty: clamp01(total.certainty),
        commitment: clamp01(total.commitment / divisor),
        dominance: clamp01(total.dominance / divisor),
        durability: clamp01(total.durability / divisor),
        relevance: clamp01(total.relevance),
        valence: clampSigned(total.valence / divisor),
    };
}

function extractKeyphrases(tokens: string[], text: string, limit: number): string[] {
    const counts = new Map<string, number>();
    for (const token of tokens) {
        counts.set(token, (counts.get(token) ?? 0) + (DOMAIN_LEXICON.has(token) ? 2 : 1));
    }
    for (const phrase of DOMAIN_LEXICON) {
        if (phrase.length > 2 && text.toLowerCase().includes(phrase)) {
            counts.set(phrase, (counts.get(phrase) ?? 0) + 3);
        }
    }
    return [...counts.entries()]
        .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, Math.max(0, limit))
        .map(([token]) => token);
}

function domainRelevance(tokens: string[]): number {
    if (tokens.length === 0) {
        return 0;
    }
    const hits = tokens.filter((token) => DOMAIN_LEXICON.has(token)).length;
    return clamp01(0.35 + hits / Math.max(4, tokens.length));
}

function punctuationArousal(text: string): number {
    const emphatic = countMatches(text, /[!！?？]/gu);
    return clamp01(0.25 + Math.min(0.4, emphatic * 0.08));
}

function createSegmenter(language: string, granularity: "sentence" | "word"): Intl.Segmenter | undefined {
    if (!("Segmenter" in Intl)) {
        return undefined;
    }
    return new Intl.Segmenter(language === "zh" ? "zh" : undefined, { granularity });
}

function countMatches(text: string, pattern: RegExp): number {
    return [...text.matchAll(pattern)].length;
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
