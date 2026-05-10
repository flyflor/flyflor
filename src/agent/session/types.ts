import type { ModelRole } from "../../protocol/contracts/index.ts";

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

export interface SessionSummary {
    key: string;
    channel: string;
    chatId: string;
    chatType: string;
    threadId?: string;
    accountId?: string;
    userId: string;
    createdAt: string;
    updatedAt: string;
    lastConsolidatedSequence: number;
    liveMessageCount: number;
    totalMessageCount: number;
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
