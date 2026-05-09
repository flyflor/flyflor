import type { MemorySessionConfig } from "../../config/index.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../../fpc/contracts/index.ts";
import { Session } from "../../fpc/decorators/index.ts";
import { scopeFor } from "./scope.ts";
import type { HistoryEntry, SessionIdentity, SessionMessageRecord, SessionSummary } from "./types.ts";

export interface SessionStore {
    consolidateSession(sessionKey: string, config: MemorySessionConfig, now: string): Promise<HistoryEntry[]>;
    listSessions(limit: number): Promise<SessionSummary[]>;
    recentMessages(sessionKey: string, limit: number): Promise<SessionMessageRecord[]>;
    recordTurn(message: GatewayMessage, reply: GatewayReply, context: RuntimeContext): Promise<SessionIdentity>;
    sessionMessages(sessionKey: string, limit: number): Promise<SessionMessageRecord[]>;
}

@Session()
export class AgentSession {
    constructor(
        private readonly store: SessionStore,
        private readonly config: MemorySessionConfig,
    ) {}

    keyFor(message: GatewayMessage): string {
        return scopeFor(message);
    }

    recentMessagesFor(message: GatewayMessage, limit = this.config.maxPromptMessages): Promise<SessionMessageRecord[]> {
        return this.store.recentMessages(this.keyFor(message), limit);
    }

    recordTurn(message: GatewayMessage, reply: GatewayReply, context: RuntimeContext): Promise<SessionIdentity> {
        return this.store.recordTurn(message, reply, context);
    }

    consolidate(sessionKey: string, now: string): Promise<HistoryEntry[]> {
        return this.store.consolidateSession(sessionKey, this.config, now);
    }

    list(limit: number): Promise<SessionSummary[]> {
        return this.store.listSessions(limit);
    }

    timeline(sessionKey: string, limit: number): Promise<SessionMessageRecord[]> {
        return this.store.sessionMessages(sessionKey, limit);
    }
}

export { scopeFor, sessionIdentityFor } from "./scope.ts";
export type { HistoryEntry, SessionIdentity, SessionMessageRecord, SessionSummary } from "./types.ts";
