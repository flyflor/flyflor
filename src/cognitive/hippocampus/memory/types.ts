import type {
    MarkdownMemoryFile,
    MemoryCandidateStatus,
    MemoryKind,
    MemoryLayer,
    MemorySourceKind,
} from "../../../protocol/contracts/index.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../../../protocol/contracts/index.ts";
import type { CodenameRecord, ScopeRecord } from "../../../protocol/contracts/index.ts";
import type { ScopeVectorHit } from "../scope/vector/component.ts";

export interface MemoryRecord {
    id: string;
    kind: MemoryKind;
    content: string;
    scope: string;
    subjectId?: string;
    importance: number;
    confidence: number;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
}

export interface MemoryWeights {
    actionability: number;
    arousal: number;
    certainty: number;
    importance: number;
    confidence: number;
    durability: number;
    dominance: number;
    emotionalValence: number;
    recurrence: number;
    relevance: number;
    sourceDiversity: number;
    validationCount: number;
}

export interface MemoryMatrixResult {
    aggregate: {
        aggregationMs: number;
        baseImportance: number;
        importanceDelta: number;
        recallBoost: number;
        reflectionPriority: number;
        residualValue: number;
    };
    columns: string[];
    matrix: number[][];
    natural: {
        sentiment: number;
        tfidfPeak: number;
        tokenCount: number;
        uniqueTokenRatio: number;
    };
    residual: {
        contradictionRisk: number;
        decayRisk: number;
        lexicalNovelty: number;
        reusePotential: number;
        uncertainty: number;
    };
    rows: string[];
    schemaVersion: 1;
}

export interface MemoryCandidate {
    id: string;
    targetFile: MarkdownMemoryFile;
    kind: MemoryKind;
    status: MemoryCandidateStatus;
    sourceKind: MemorySourceKind;
    content: string;
    projectId: string;
    sourceId: string;
    sourceMessageId?: string;
    sourceReplyId?: string;
    createdAt: string;
    promotedAt?: string;
    weights: MemoryWeights;
    metadata?: Record<string, unknown>;
}

export interface MemoryEpisodeProvenance {
    behaviorSnapshotId?: string;
    /** Authoritative brain.db event id for the turn that produced this working-memory episode. */
    brainEventId?: string;
    /** Summary/link id for a blackboard turn. Stored as structured provenance, not as prompt-visible reasoning. */
    blackboardTurnId?: string;
    mcpCalls?: Array<{
        error?: string;
        ok: boolean;
        resultSummary?: string;
        resultSummaryMeta?: Record<string, unknown>;
        server: string;
        tool: string;
    }>;
    subagentBatches?: Array<{
        batchId?: string;
        children: Array<{
            id: string;
            ok: boolean;
            status: string;
            toolCalls: number;
        }>;
        needsUser: boolean;
    }>;
    skillNames?: string[];
}

export interface TurnMemoryResult {
    askEventId?: string;
    answeredAskSnapshotId?: string;
    candidates: MemoryCandidate[];
    promoted: MemoryRecord[];
}

export interface MemorySearchRequest {
    query: string;
    scope: string;
    subjectId?: string;
    limit: number;
}

export interface MemorySearchResult {
    record: MemoryRecord;
    score: number;
    layer: MemoryLayer;
}

export interface ScopeRecallCandidate {
    scope: ScopeRecord;
    codename?: CodenameRecord;
    vector?: ScopeVectorHit;
    vectorSummary?: string;
}

export interface MemoryTurn {
    message: GatewayMessage;
    reply: GatewayReply;
    context: RuntimeContext;
}
