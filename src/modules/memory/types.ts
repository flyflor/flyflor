import type {
    MarkdownMemoryFile,
    MemoryCandidateStatus,
    MemoryKind,
    MemoryLayer,
    MemorySourceKind,
    ModelRole,
} from "../../shared/core/enums.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../../shared/core/types.ts";

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

export interface SessionIdentity {
    key: string;
    channel: string;
    chatId: string;
    chatType: string;
    threadId?: string;
    accountId?: string;
    userId: string;
}

export interface SessionMessageRecord {
    id: string;
    sessionKey: string;
    sequence: number;
    role: ModelRole;
    content: string;
    gatewayMessageId?: string;
    gatewayReplyId?: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface HistoryEntry {
    cursor: number;
    timestamp: string;
    sessionKey: string;
    content: string;
    sourceStartSequence?: number;
    sourceEndSequence?: number;
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

export interface MemorySignalAnalysis {
    language: string;
    candidateScore: number;
    keyphrases: string[];
    selectedText: string;
    affect: {
        arousal: number;
        dominance: number;
        valence: number;
    };
    signals: {
        actionability: number;
        certainty: number;
        commitment: number;
        durability: number;
        novelty: number;
        relevance: number;
    };
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
