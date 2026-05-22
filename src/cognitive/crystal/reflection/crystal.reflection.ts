import type {
    CrystalBucketId,
    CrystalCoordinates,
    CrystalEvidence,
    CrystalRecallRequest,
    CrystalRecallResult,
    CrystalGem,
    ReflectionAtom,
    ReflectionCandidate,
} from "../../../protocol/contracts/index.ts";
import { Component } from "../../../agent/di/decorators/index.ts";
import { CrystalComponent } from "../../../components/component.ts";

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

export interface ContextForkClosureCandidateInput {
    closureEvidence: CrystalEvidence[];
    conflictCount?: number;
    createdAt: string;
    forkId: string;
    mergedSummary: string;
    metadata?: Record<string, unknown>;
    symbols?: string[];
}

export const CrystalGemQualityGateCode = {
    Passed: "passed",
    NoEvidence: "no-evidence",
    EvidenceBelowThreshold: "evidence-below-threshold",
    MissingStructuredProvenance: "missing-structured-provenance",
    RawSource: "raw-source",
    MissingReusableSurface: "missing-reusable-surface",
} as const;

export type CrystalGemQualityGateCode = (typeof CrystalGemQualityGateCode)[keyof typeof CrystalGemQualityGateCode];

export interface CrystalGemQualityGateAudit {
    candidateId: string;
    code: CrystalGemQualityGateCode;
    distinctEvidenceSourceIds: number;
    evidenceCount: number;
    evidenceScore: number;
    passed: boolean;
    positiveEvidenceCount: number;
    provenance: {
        evidence: Array<{
            kind: string;
            sourceId: string;
            weight: number;
        }>;
        sourceId: string;
        sourceKind: string;
    };
    requirements: {
        minEvidenceScore: number;
        minPositiveEvidenceCount: number;
        minReusableSymbols: number;
    };
}

const CrystalGemQualityGateRequirement = {
    MinEvidenceScore: 0.65,
    MinPositiveEvidenceCount: 1,
    MinReusableSymbols: 1,
} as const;

// These are structured provenance owners that may remain candidate/audit data
// but must never be promoted directly as durable methodology.
const CrystalRawCandidateSourceKind = {
    Conversation: "conversation",
    LedgerEvent: "ledger-event",
    Query: "query",
    RawLedgerEvent: "raw-ledger-event",
    RecentConversation: "recent-conversation",
    RuntimeTurn: "runtime-turn",
} as const;

/**
 * Owns the deterministic, non-LLM part of crystal reflection.
 *
 * The model decides whether a candidate exists; this component only normalizes
 * structured evidence into atoms/gems and scores recall with numeric signals.
 */
@Component()
export class CrystalReflectionComponent extends CrystalComponent {
    public buildCandidate(input: CrystalCandidateInput): ReflectionCandidate {
        const symbols = this.normalizeSymbols([...(input.symbols ?? []), ...this.extractSymbolTokens(input.content)]);
        return {
            id: input.id,
            sourceId: input.sourceId,
            sourceKind: input.sourceKind,
            content: this.compactText(input.content, 1200),
            bucket: input.bucketHint ?? this.dynamicBucketId(symbols, input.content),
            symbols,
            coordinates: this.normalizeCoordinates(input.coordinates),
            evidence: input.evidence,
            createdAt: input.createdAt,
            metadata: {
                ...(input.metadata ?? {}),
                method: input.method,
                title: input.title,
            },
        };
    }

    /**
     * Converts a completed fork merge into crystal evidence. Conflict detection
     * and merge intent must already be expressed by structured fields upstream;
     * this method never inspects natural-language text to decide merge success.
     */
    public buildContextForkClosureCandidate(input: ContextForkClosureCandidateInput): ReflectionCandidate {
        return this.buildCandidate({
            id: `fork-closure-${this.hashText(`${input.forkId}:${input.mergedSummary}`)}`,
            sourceId: input.forkId,
            sourceKind: "context-fork-closure",
            content: input.mergedSummary,
            createdAt: input.createdAt,
            evidence: input.closureEvidence,
            method: input.mergedSummary,
            title: `fork-closure:${input.forkId}`,
            symbols: this.normalizeSymbols(["context-fork", "closure", input.forkId, ...(input.symbols ?? [])]),
            metadata: {
                ...(input.metadata ?? {}),
                conflictCount: Math.max(0, Math.floor(input.conflictCount ?? 0)),
                forkId: input.forkId,
                schemaVersion: 1,
            },
        });
    }

    public crystallizeCandidate(candidate: ReflectionCandidate): { atom: ReflectionAtom; gem: CrystalGem } | undefined {
        const qualityGate = this.evaluateGemQualityGate(candidate);
        if (!qualityGate.passed) {
            return undefined;
        }
        const evidenceScore = qualityGate.evidenceScore;

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
                evidence: candidate.evidence,
                qualityGate,
            },
        };

        const gem: CrystalGem = {
            id: this.stableGemId(candidate.bucket, candidate.symbols),
            bucket: candidate.bucket,
            title: this.titleFor(candidate),
            method: this.methodFor(candidate),
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
                qualityGate,
                sourceCandidateIds: [candidate.id],
                sourceKind: candidate.sourceKind,
                consolidationEvidence: candidate.evidence.map((item) => ({
                    ...item,
                    candidateId: candidate.id,
                })),
            },
        };

        return { atom, gem };
    }

    public attachQualityGateAudit(
        candidate: ReflectionCandidate,
        audit: CrystalGemQualityGateAudit = this.evaluateGemQualityGate(candidate),
    ): ReflectionCandidate {
        return {
            ...candidate,
            metadata: {
                ...(candidate.metadata ?? {}),
                qualityGate: audit,
            },
        };
    }

    public evaluateGemQualityGate(candidate: ReflectionCandidate): CrystalGemQualityGateAudit {
        const evidenceScore = this.scoreEvidence(candidate.evidence);
        const positiveEvidence = candidate.evidence.filter(
            (item) => item.weight > 0 && item.kind.trim().length > 0 && item.sourceId.trim().length > 0,
        );
        const distinctEvidenceSourceIds = new Set(positiveEvidence.map((item) => item.sourceId)).size;
        const rawSourceKinds = new Set<string>(Object.values(CrystalRawCandidateSourceKind));
        const code = this.gemQualityGateCode(candidate, evidenceScore, positiveEvidence.length, rawSourceKinds);
        return {
            candidateId: candidate.id,
            code,
            distinctEvidenceSourceIds,
            evidenceCount: candidate.evidence.length,
            evidenceScore,
            passed: code === CrystalGemQualityGateCode.Passed,
            positiveEvidenceCount: positiveEvidence.length,
            provenance: {
                evidence: candidate.evidence.map((item) => ({
                    kind: item.kind,
                    sourceId: item.sourceId,
                    weight: this.clamp01(item.weight),
                })),
                sourceId: candidate.sourceId,
                sourceKind: candidate.sourceKind,
            },
            requirements: {
                minEvidenceScore: CrystalGemQualityGateRequirement.MinEvidenceScore,
                minPositiveEvidenceCount: CrystalGemQualityGateRequirement.MinPositiveEvidenceCount,
                minReusableSymbols: CrystalGemQualityGateRequirement.MinReusableSymbols,
            },
        };
    }

    public mergeGem(existing: CrystalGem | undefined, incoming: CrystalGem): CrystalGem {
        if (!existing) {
            return incoming;
        }

        const support = existing.support + incoming.support;
        const existingWeight = existing.support / support;
        const incomingWeight = incoming.support / support;
        return {
            ...existing,
            method: incoming.evidenceScore >= existing.evidenceScore ? incoming.method : existing.method,
            symbols: this.normalizeSymbols([...existing.symbols, ...incoming.symbols]),
            coordinates: this.averageCoordinates(existing.coordinates, incoming.coordinates, existingWeight, incomingWeight),
            confidence: this.clamp01(existing.confidence * existingWeight + incoming.confidence * incomingWeight),
            support,
            evidenceScore: Math.max(existing.evidenceScore, incoming.evidenceScore),
            updatedAt: incoming.updatedAt,
            sourceAtomIds: [...new Set([...existing.sourceAtomIds, ...incoming.sourceAtomIds])],
            metadata: {
                ...(existing.metadata ?? {}),
                latestCandidateId: incoming.metadata?.latestCandidateId,
                qualityGate: incoming.metadata?.qualityGate,
                sourceCandidateIds: this.mergeMetadataArray(
                    existing.metadata?.sourceCandidateIds,
                    incoming.metadata?.sourceCandidateIds,
                    64,
                ),
                consolidationEvidence: this.mergeMetadataArray(
                    existing.metadata?.consolidationEvidence,
                    incoming.metadata?.consolidationEvidence,
                    128,
                ),
            },
        };
    }

    public recallGems(request: CrystalRecallRequest, gems: CrystalGem[]): CrystalRecallResult[] {
        const querySymbols = this.normalizeSymbols([...(request.symbols ?? []), ...this.extractSymbolTokens(request.query)]);
        const queryBucket = request.buckets?.[0] ?? this.dynamicBucketId(querySymbols, request.query);
        const queryCoordinates = this.normalizeCoordinates();

        return gems
            .map((gem) => {
                const bucketScore = gem.bucket === queryBucket ? 1 : 0;
                const symbolScore = this.overlapScore(querySymbols, gem.symbols);
                const coordinateScore = this.cosineSimilarity(queryCoordinates, gem.coordinates);
                const confidenceScore = this.clamp01(
                    (gem.confidence + Math.min(1, gem.support / Math.max(1, gem.sourceAtomIds.length))) / 2,
                );
                const signals = [bucketScore, symbolScore, coordinateScore, confidenceScore];
                const score = signals.reduce((sum, value) => sum + value, 0) / signals.length;
                return {
                    gem,
                    score,
                    evidence: {
                        bucketMatch: bucketScore,
                        symbolOverlap: symbolScore,
                        coordinateSimilarity: coordinateScore,
                        confidence: confidenceScore,
                    },
                    reasons: [
                        bucketScore > 0 ? `bucket:${gem.bucket}` : "",
                        symbolScore > 0 ? `symbols:${symbolScore.toFixed(2)}` : "",
                        coordinateScore > 0 ? `space:${coordinateScore.toFixed(2)}` : "",
                    ].filter(Boolean),
                };
            })
            .filter((result) => result.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, request.limit);
    }

    public scoreEvidence(evidence: CrystalEvidence[]): number {
        if (evidence.length === 0) {
            return 0;
        }
        return this.clamp01(evidence.reduce((sum, item) => sum + this.clamp01(item.weight), 0) / evidence.length);
    }

    public evidence(kind: string, weight: number, sourceId: string, note: string): CrystalEvidence {
        return { kind, weight: this.clamp01(weight), sourceId, note };
    }

    private titleFor(candidate: ReflectionCandidate): string {
        const explicit = typeof candidate.metadata?.title === "string" ? candidate.metadata.title : undefined;
        if (explicit) {
            return explicit;
        }
        const first = candidate.symbols.slice(0, 3).join("/");
        return `${candidate.bucket}:${first || "method"}`;
    }

    private methodFor(candidate: ReflectionCandidate): string {
        const explicit = typeof candidate.metadata?.method === "string" ? candidate.metadata.method : undefined;
        return this.compactText((explicit ?? candidate.content).replace(/\s+/g, " ").trim(), 480);
    }

    private dynamicBucketId(symbols: string[], content: string): string {
        const basis = symbols.length > 0 ? symbols.slice(0, 4).join(":") : content.slice(0, 120);
        return `bucket-${this.hashText(basis)}`;
    }

    private stableGemId(bucketId: CrystalBucketId, symbols: string[]): string {
        return `crystal-${this.hashText(`${bucketId}:${symbols.slice(0, 6).join(":")}`)}`;
    }

    private gemQualityGateCode(
        candidate: ReflectionCandidate,
        evidenceScore: number,
        positiveEvidenceCount: number,
        rawSourceKinds: Set<string>,
    ): CrystalGemQualityGateCode {
        if (candidate.evidence.length === 0) {
            return CrystalGemQualityGateCode.NoEvidence;
        }
        if (rawSourceKinds.has(candidate.sourceKind)) {
            return CrystalGemQualityGateCode.RawSource;
        }
        if (positiveEvidenceCount < CrystalGemQualityGateRequirement.MinPositiveEvidenceCount) {
            return CrystalGemQualityGateCode.MissingStructuredProvenance;
        }
        if (candidate.symbols.length < CrystalGemQualityGateRequirement.MinReusableSymbols) {
            return CrystalGemQualityGateCode.MissingReusableSurface;
        }
        if (evidenceScore < CrystalGemQualityGateRequirement.MinEvidenceScore) {
            return CrystalGemQualityGateCode.EvidenceBelowThreshold;
        }
        return CrystalGemQualityGateCode.Passed;
    }

    private extractSymbolTokens(text: string): string[] {
        return text
            .toLowerCase()
            .split(/[^\p{L}\p{N}_-]+/u)
            .filter((token) => token.length > 0)
            .slice(0, 16);
    }

    private normalizeSymbols(symbols: string[]): string[] {
        return [...new Set(symbols.map((symbol) => symbol.toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
    }

    private normalizeCoordinates(input: CrystalCoordinates = {}): CrystalCoordinates {
        return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, this.clamp01(value)]));
    }

    private averageCoordinates(
        left: CrystalCoordinates,
        right: CrystalCoordinates,
        leftWeight: number,
        rightWeight: number,
    ): CrystalCoordinates {
        const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
        return Object.fromEntries(
            keys.map((key) => [key, this.clamp01((left[key] ?? 0) * leftWeight + (right[key] ?? 0) * rightWeight)]),
        );
    }

    private overlapScore(left: string[], right: string[]): number {
        if (left.length === 0 || right.length === 0) {
            return 0;
        }
        const rightSet = new Set(right);
        const hits = left.filter((item) => rightSet.has(item)).length;
        return this.clamp01(hits / Math.max(left.length, right.length));
    }

    private cosineSimilarity(left: CrystalCoordinates, right: CrystalCoordinates): number {
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
        return this.clamp01(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
    }

    private compactText(text: string, limit: number): string {
        const compacted = text.replace(/\s+/g, " ").trim();
        return compacted.length <= limit ? compacted : compacted.slice(0, limit).trimEnd();
    }

    private mergeMetadataArray(left: unknown, right: unknown, limit: number): unknown[] | undefined {
        const merged = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];
        if (merged.length === 0) {
            return undefined;
        }
        return merged.slice(-limit);
    }

    private hashText(text: string): string {
        const bytes = new TextEncoder().encode(text);
        let hash = 2166136261;
        for (const byte of bytes) {
            hash ^= byte;
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    }

    private clamp01(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, Math.min(1, value));
    }
}

const defaultReflection = new CrystalReflectionComponent();

export function buildReflectionCandidate(input: CrystalCandidateInput): ReflectionCandidate {
    return defaultReflection.buildCandidate(input);
}

export function buildContextForkClosureCandidate(input: ContextForkClosureCandidateInput): ReflectionCandidate {
    return defaultReflection.buildContextForkClosureCandidate(input);
}

export function crystallizeCandidate(
    candidate: ReflectionCandidate,
): { atom: ReflectionAtom; gem: CrystalGem } | undefined {
    return defaultReflection.crystallizeCandidate(candidate);
}

export function attachCrystalGemQualityGateAudit(candidate: ReflectionCandidate): ReflectionCandidate {
    return defaultReflection.attachQualityGateAudit(candidate);
}

export function evaluateCrystalGemQualityGate(candidate: ReflectionCandidate): CrystalGemQualityGateAudit {
    return defaultReflection.evaluateGemQualityGate(candidate);
}

export function mergeCrystalGem(existing: CrystalGem | undefined, incoming: CrystalGem): CrystalGem {
    return defaultReflection.mergeGem(existing, incoming);
}

export function recallCrystalGems(request: CrystalRecallRequest, gems: CrystalGem[]): CrystalRecallResult[] {
    return defaultReflection.recallGems(request, gems);
}

export function scoreEvidence(evidence: CrystalEvidence[]): number {
    return defaultReflection.scoreEvidence(evidence);
}

export function evidence(kind: string, weight: number, sourceId: string, note: string): CrystalEvidence {
    return defaultReflection.evidence(kind, weight, sourceId, note);
}
