import type { AskMeta, BlackboardMeta, McpTrace } from "./types.ts";

export function readRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function readString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    return undefined;
}

function readNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
}

export function readStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
    return [];
}

export function readBlackboardMeta(meta: Record<string, unknown> | null): BlackboardMeta | null {
    if (!meta) return null;
    const record = readRecord(meta.blackboard) ?? readRecord(meta);
    if (!record) return null;
    const mode = readString(record.mode) ?? readString(record.blackboardMode);
    if (!mode) return null;
    return {
        mode,
        elapsedMs: readNumber(record.elapsedMs) ?? readNumber(record.blackboardElapsedMs),
        messages: readNumber(record.messages) ?? readNumber(record.blackboardMessages),
        reason: readString(record.reason) ?? readString(record.blackboardReason),
        status: readString(record.status) ?? readString(record.blackboardStatus),
        turnId: readString(record.turnId) ?? readString(record.blackboardTurnId),
    };
}

export function readAskMeta(meta: Record<string, unknown> | null): AskMeta | null {
    if (!meta || meta.kind !== "ask") return null;
    const record = readRecord(meta.ask);
    if (!record) return { reason: "ask" };
    return {
        choices: readNumber(record.choices),
        questions: readNumber(record.questions),
        reason: readString(record.reason),
        snapshotId: readString(record.snapshotId),
    };
}

export function readMcpTrace(entry: unknown): McpTrace | null {
    const record = readRecord(entry);
    if (!record) return null;
    return {
        ok: record.ok === true,
        resultText: readString(record.resultSummary) ?? readString(record.resultText) ?? "",
        server: readString(record.server) ?? "",
        tool: readString(record.tool) ?? "",
    };
}
