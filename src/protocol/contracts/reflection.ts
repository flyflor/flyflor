export type CrystalBucketId = string;
export type CrystalCoordinateKey = string;
export type CrystalEvidenceKind = string;
export type CrystalEdgeKind = string;
export type CrystalCoordinates = Record<CrystalCoordinateKey, number>;

export interface CrystalEvidence {
    kind: CrystalEvidenceKind;
    weight: number;
    sourceId: string;
    note: string;
}

export interface ReflectionCandidate {
    id: string;
    sourceId: string;
    sourceKind: string;
    content: string;
    bucket: CrystalBucketId;
    symbols: string[];
    coordinates: CrystalCoordinates;
    evidence: CrystalEvidence[];
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface ReflectionAtom {
    id: string;
    candidateId: string;
    bucket: CrystalBucketId;
    content: string;
    symbols: string[];
    coordinates: CrystalCoordinates;
    evidenceScore: number;
    confidence: number;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface CrystalGem {
    id: string;
    bucket: CrystalBucketId;
    title: string;
    method: string;
    symbols: string[];
    coordinates: CrystalCoordinates;
    confidence: number;
    support: number;
    evidenceScore: number;
    createdAt: string;
    updatedAt: string;
    sourceAtomIds: string[];
    metadata?: Record<string, unknown>;
}

export interface CrystalRecallRequest {
    query: string;
    limit: number;
    buckets?: CrystalBucketId[];
    symbols?: string[];
}

export interface CrystalRecallResult {
    gem: CrystalGem;
    score: number;
    reasons: string[];
}
