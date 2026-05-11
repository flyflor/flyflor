import { evidence, type CrystalCandidateInput } from "../../crystal/reflection/index.ts";
import {
    BlackboardMode,
    BlackboardTurnStatus,
    type CrystalEvidence,
    ModelRole,
    type ModelClient,
    type ModelMessage,
} from "../../protocol/contracts/index.ts";
import { renderCrystalReflectionPrompt } from "../prompts/index.ts";
import type { RuntimeBlackboardRouteDecision } from "./blackboard.route.ts";

export interface RuntimeReflectionSource {
    answer: string;
    blackboard?: {
        decisions: Array<{ reason: string; prompt: string }>;
        mode: BlackboardMode;
        reason: string;
        status?: string;
        steps: Array<{
            blockers: string[];
            newFacts: string[];
            outputSummary: string;
            workerRole: string;
        }>;
        turnId?: string;
    };
    now: string;
    request: string;
    requestId: string;
    route?: RuntimeBlackboardRouteDecision;
    mcpCalls?: Array<{
        error?: string;
        ok: boolean;
        resultSummary?: string;
        server: string;
        tool: string;
    }>;
    skillNames?: string[];
}

interface ExtractedReflectionItem {
    bucketHint?: string;
    coordinates?: Record<string, number>;
    method?: string;
    symbols?: string[];
    title?: string;
}

export async function extractRuntimeReflectionCandidates(
    model: ModelClient,
    source: RuntimeReflectionSource,
): Promise<CrystalCandidateInput[]> {
    const evidenceText = renderReflectionEvidence(source);
    const messages: ModelMessage[] = [
        {
            role: ModelRole.System,
            content: renderCrystalReflectionPrompt({ evidence: evidenceText }),
        },
        {
            role: ModelRole.User,
            content: evidenceText,
        },
    ];
    const raw = await model.generate(messages);
    return parseReflectionItems(raw).map((item, index) => reflectionCandidateFromItem(item, index, source, raw));
}

function reflectionCandidateFromItem(
    item: ExtractedReflectionItem,
    index: number,
    source: RuntimeReflectionSource,
    raw: string,
): CrystalCandidateInput {
    const method = item.method?.trim() || "";
    const title = item.title?.trim() || "";
    const content = [title, method].filter(Boolean).join(": ");
    return {
        id: `runtime-reflection-${hashText(`${source.requestId}:${index}:${content}:${raw}`)}`,
        sourceId: source.blackboard?.turnId ?? source.requestId,
        sourceKind: "runtime-reflection",
        content: content || raw,
        createdAt: source.now,
        bucketHint: item.bucketHint,
        coordinates: normalizeCoordinates(item.coordinates),
        evidence: reflectionEvidenceFor(source),
        method,
        metadata: {
            blackboardReason: source.blackboard?.reason,
            blackboardStatus: source.blackboard?.status,
            routeMode: source.route?.mode,
            routeReason: source.route?.reason,
            schemaVersion: 1,
            mcpCalls: source.mcpCalls,
            skillNames: source.skillNames,
        },
        symbols: normalizeStringArray(item.symbols),
        title,
    };
}

function reflectionEvidenceFor(source: RuntimeReflectionSource): CrystalEvidence[] {
    if (!source.blackboard) {
        return [evidence("runtime-direct-reflection", 0, source.requestId, "direct turn reflection candidate")];
    }
    if (source.blackboard.status === BlackboardTurnStatus.Converged) {
        return [
            evidence(
                "blackboard-converged-reflection",
                0.8,
                source.blackboard.turnId ?? source.requestId,
                "blackboard converged before reflection",
            ),
        ];
    }
    if (source.blackboard.status === BlackboardTurnStatus.NeedsUser) {
        return [
            evidence(
                "blackboard-needs-user-reflection",
                0.65,
                source.blackboard.turnId ?? source.requestId,
                "blackboard produced structured blockers before reflection",
            ),
        ];
    }
    return [
        evidence(
            "blackboard-unverified-reflection",
            0,
            source.blackboard.turnId ?? source.requestId,
            "blackboard did not reach a verified terminal state",
        ),
    ];
}

function renderReflectionEvidence(source: RuntimeReflectionSource): string {
    return JSON.stringify(
        {
            request: source.request,
            route: source.route
                ? {
                      mode: source.route.mode,
                      reason: source.route.reason,
                      score: source.route.score,
                      signals: source.route.signals,
                  }
                : undefined,
            blackboard: source.blackboard
                ? {
                      decisions: source.blackboard.decisions,
                      mode: source.blackboard.mode,
                      reason: source.blackboard.reason,
                      status: source.blackboard.status,
                      steps: source.blackboard.steps,
                  }
                : undefined,
            answer: source.answer,
            mcpCalls: source.mcpCalls,
            skillNames: source.skillNames,
        },
        null,
        2,
    );
}

function parseReflectionItems(raw: string): ExtractedReflectionItem[] {
    const parsed = parseJson(raw);
    if (!Array.isArray(parsed)) {
        throw new Error("Crystal reflection model did not return a JSON array.");
    }
    return parsed
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
            bucketHint: readOptionalString(item.bucketHint),
            coordinates: readCoordinates(item.coordinates),
            method: readOptionalString(item.method),
            symbols: normalizeStringArray(item.symbols),
            title: readOptionalString(item.title),
        }))
        .filter((item) => Boolean(item.method || item.title));
}

function parseJson(raw: string): unknown {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u)?.[1]?.trim();
    const source = fenced ?? trimmed;
    const arrayStart = source.indexOf("[");
    const arrayEnd = source.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd >= arrayStart) {
        return JSON.parse(source.slice(arrayStart, arrayEnd + 1)) as unknown;
    }
    return JSON.parse(source) as unknown;
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readCoordinates(value: unknown): Record<string, number> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return normalizeCoordinates(value as Record<string, unknown>);
}

function normalizeCoordinates(value: Record<string, unknown> | undefined): Record<string, number> | undefined {
    if (!value) {
        return undefined;
    }
    return Object.fromEntries(
        Object.entries(value)
            .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
            .map(([key, coordinate]) => [key, Math.max(0, Math.min(1, coordinate))]),
    );
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
