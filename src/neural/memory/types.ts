import type {
    MarkdownMemoryFile,
    MemoryCandidateStatus,
    MemoryKind,
    MemoryLayer,
    MemorySourceKind,
} from "../../protocol/contracts/index.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../../protocol/contracts/index.ts";
import type { HistoryEntry, SessionIdentity, SessionMessageRecord, SessionSummary } from "../../agent/session/index.ts";
import type { MemoryAction } from "./actions.ts";

export interface MemoryRecord {
    id: string;
    kind: MemoryKind;
    content: string;
    scope: string;
    subjectId?: string;
    channel?: string;
    chatId?: string;
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
    sessionKey: string;
    sourceMessageId?: string;
    sourceReplyId?: string;
    createdAt: string;
    promotedAt?: string;
    weights: MemoryWeights;
    metadata?: Record<string, unknown>;
}

export interface TurnMemoryResult {
    sessionKey: string;
    candidates: MemoryCandidate[];
    promoted: MemoryRecord[];
    historyEntries: HistoryEntry[];
}

export interface MemorySearchRequest {
    query: string;
    scope: string;
    subjectId?: string;
    channel?: string;
    chatId?: string;
    limit: number;
}

export interface MemorySearchResult {
    record: MemoryRecord;
    score: number;
    layer: MemoryLayer;
}

export interface MemoryTurn {
    message: GatewayMessage;
    reply: GatewayReply;
    context: RuntimeContext;
}

export type { MemoryAction } from "./actions.ts";
