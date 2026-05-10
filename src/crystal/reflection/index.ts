import type {
    CrystalBucketId,
    CrystalCoordinates,
    CrystalEvidence,
    CrystalRecallRequest,
    CrystalRecallResult,
    CrystalSkill,
    ReflectionAtom,
    ReflectionCandidate,
} from "../../protocol/contracts/index.ts";

export interface CrystalCandidateInput {
    id: string;
    sourceId: string;
    sourceKind: string;
    content: string;
    createdAt: string;
    evidence: CrystalEvidence[];
    bucketHint?: CrystalBucketId;
    symbols?: string[];
    coordinates?: CrystalCoordinates;
    method?: string;
    title?: string;
    metadata?: Record<string, unknown>;
}

export function buildReflectionCandidate(input: CrystalCandidateInput): ReflectionCandidate {
    const symbols = normalizeSymbols([...(input.symbols ?? []), ...extractSymbolTokens(input.content)]);
    return {
        id: input.id,
        sourceId: input.sourceId,
        sourceKind: input.sourceKind,
        content: compactText(input.content, 1200),
        bucket: input.bucketHint ?? dynamicBucketId(symbols, input.content),
        symbols,
        coordinates: normalizeCoordinates(input.coordinates),
        evidence: input.evidence,
        createdAt: input.createdAt,
        metadata: {
            ...(input.metadata ?? {}),
            method: input.method,
            title: input.title,
        },
    };
}

export function crystallizeCandidate(
    candidate: ReflectionCandidate,
): { atom: ReflectionAtom; skill: CrystalSkill } | undefined {
    const evidenceScore = scoreEvidence(candidate.evidence);
    if (evidenceScore <= 0) {
        return undefined;
    }

    const atom: ReflectionAtom = {
        id: `atom-${candidate.id}`,
        candidateId: candidate.id,
        bucket: candidate.bucket,
        content: candidate.content,
        symbols: candidate.symbols,
        coordinates: candidate.coordinates,
        evidenceScore,
        confidence: evidenceScore,
        createdAt: candidate.createdAt,
        metadata: {
            sourceKind: candidate.sourceKind,
            sourceId: candidate.sourceId,
        },
    };

    const skill: CrystalSkill = {
        id: stableSkillId(candidate.bucket, candidate.symbols),
        bucket: candidate.bucket,
        title: titleFor(candidate),
        method: methodFor(candidate),
        symbols: candidate.symbols,
        coordinates: candidate.coordinates,
        confidence: evidenceScore,
        support: Math.max(1, candidate.evidence.length),
        evidenceScore,
        createdAt: candidate.createdAt,
        updatedAt: candidate.createdAt,
        sourceAtomIds: [atom.id],
        metadata: {
            latestCandidateId: candidate.id,
            sourceKind: candidate.sourceKind,
        },
    };

    return { atom, skill };
}

export function mergeCrystalSkill(existing: CrystalSkill | undefined, incoming: CrystalSkill): CrystalSkill {
    if (!existing) {
        return incoming;
    }

    const support = existing.support + incoming.support;
    const existingWeight = existing.support / support;
    const incomingWeight = incoming.support / support;
    return {
        ...existing,
        method: incoming.evidenceScore >= existing.evidenceScore ? incoming.method : existing.method,
        symbols: normalizeSymbols([...existing.symbols, ...incoming.symbols]),
        coordinates: averageCoordinates(existing.coordinates, incoming.coordinates, existingWeight, incomingWeight),
        confidence: clamp01(existing.confidence * existingWeight + incoming.confidence * incomingWeight),
        support,
        evidenceScore: Math.max(existing.evidenceScore, incoming.evidenceScore),
        updatedAt: incoming.updatedAt,
        sourceAtomIds: [...new Set([...existing.sourceAtomIds, ...incoming.sourceAtomIds])],
        metadata: {
            ...(existing.metadata ?? {}),
            latestCandidateId: incoming.metadata?.latestCandidateId,
        },
    };
}

export function recallCrystalSkills(request: CrystalRecallRequest, skills: CrystalSkill[]): CrystalRecallResult[] {
    const querySymbols = normalizeSymbols([...(request.symbols ?? []), ...extractSymbolTokens(request.query)]);
    const queryBucket = request.buckets?.[0] ?? dynamicBucketId(querySymbols, request.query);
    const queryCoordinates = normalizeCoordinates();

    return skills
        .map((skill) => {
            const bucketScore = skill.bucket === queryBucket ? 1 : 0;
            const symbolScore = overlapScore(querySymbols, skill.symbols);
            const coordinateScore = cosineSimilarity(queryCoordinates, skill.coordinates);
            const confidenceScore = clamp01(
                (skill.confidence + Math.min(1, skill.support / Math.max(1, skill.sourceAtomIds.length))) / 2,
            );
            const signals = [bucketScore, symbolScore, coordinateScore, confidenceScore];
            const score = signals.reduce((sum, value) => sum + value, 0) / signals.length;
            return {
                skill,
                score,
                reasons: [
                    bucketScore > 0 ? `bucket:${skill.bucket}` : "",
                    symbolScore > 0 ? `symbols:${symbolScore.toFixed(2)}` : "",
                    coordinateScore > 0 ? `space:${coordinateScore.toFixed(2)}` : "",
                ].filter(Boolean),
            };
        })
        .filter((result) => result.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, request.limit);
}

export function scoreEvidence(evidence: CrystalEvidence[]): number {
    if (evidence.length === 0) {
        return 0;
    }
    return clamp01(evidence.reduce((sum, item) => sum + clamp01(item.weight), 0) / evidence.length);
}

export function evidence(kind: string, weight: number, sourceId: string, note: string): CrystalEvidence {
    return { kind, weight: clamp01(weight), sourceId, note };
}

function titleFor(candidate: ReflectionCandidate): string {
    const explicit = typeof candidate.metadata?.title === "string" ? candidate.metadata.title : undefined;
    if (explicit) {
        return explicit;
    }
    const first = candidate.symbols.slice(0, 3).join("/");
    return `${candidate.bucket}:${first || "method"}`;
}

function methodFor(candidate: ReflectionCandidate): string {
    const explicit = typeof candidate.metadata?.method === "string" ? candidate.metadata.method : undefined;
    return compactText((explicit ?? candidate.content).replace(/\s+/g, " ").trim(), 480);
}

function dynamicBucketId(symbols: string[], content: string): string {
    const basis = symbols.length > 0 ? symbols.slice(0, 4).join(":") : content.slice(0, 120);
    return `bucket-${hashText(basis)}`;
}

function stableSkillId(bucketId: CrystalBucketId, symbols: string[]): string {
    return `crystal-${hashText(`${bucketId}:${symbols.slice(0, 6).join(":")}`)}`;
}

function extractSymbolTokens(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((token) => token.length > 0)
        .slice(0, 16);
}

function normalizeSymbols(symbols: string[]): string[] {
    return [...new Set(symbols.map((symbol) => symbol.toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
}

function normalizeCoordinates(input: CrystalCoordinates = {}): CrystalCoordinates {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, clamp01(value)]));
}

function averageCoordinates(
    left: CrystalCoordinates,
    right: CrystalCoordinates,
    leftWeight: number,
    rightWeight: number,
): CrystalCoordinates {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    return Object.fromEntries(
        keys.map((key) => [key, clamp01((left[key] ?? 0) * leftWeight + (right[key] ?? 0) * rightWeight)]),
    );
}

function overlapScore(left: string[], right: string[]): number {
    if (left.length === 0 || right.length === 0) {
        return 0;
    }
    const rightSet = new Set(right);
    const hits = left.filter((item) => rightSet.has(item)).length;
    return clamp01(hits / Math.max(left.length, right.length));
}

function cosineSimilarity(left: CrystalCoordinates, right: CrystalCoordinates): number {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (const key of keys) {
        const leftValue = left[key] ?? 0;
        const rightValue = right[key] ?? 0;
        dot += leftValue * rightValue;
        leftNorm += leftValue ** 2;
        rightNorm += rightValue ** 2;
    }
    if (leftNorm === 0 || rightNorm === 0) {
        return 0;
    }
    return clamp01(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function compactText(text: string, limit: number): string {
    const compacted = text.replace(/\s+/g, " ").trim();
    return compacted.length <= limit ? compacted : compacted.slice(0, limit).trimEnd();
}

function hashText(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let hash = 2166136261;
    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}
