import { BlackboardMode, ModelRole, type ModelClient, type ModelMessage } from "../../protocol/contracts/index.ts";
import type { BlackboardWorkerPlanInput } from "../blackboard/index.ts";
import { renderBlackboardRoutePrompt } from "../prompts/index.ts";

export interface RuntimeBlackboardRouteDecision {
    mode: BlackboardMode;
    score: number;
    reason: string;
    signals: string[];
    needsReflectionCandidate: boolean;
    workers: BlackboardWorkerPlanInput[];
    raw: string;
}

export async function decideBlackboardRoute(
    model: ModelClient,
    request: string,
): Promise<RuntimeBlackboardRouteDecision> {
    const messages: ModelMessage[] = [
        {
            role: ModelRole.System,
            content: renderBlackboardRoutePrompt({ request }),
        },
        {
            role: ModelRole.User,
            content: request,
        },
    ];
    const raw = await model.generate(messages);
    return parseBlackboardRouteDecision(raw);
}

export function parseBlackboardRouteDecision(raw: string): RuntimeBlackboardRouteDecision {
    const parsed = parseJsonObject(raw);
    const mode = readMode(parsed.mode);
    const score = readScore(parsed.score);
    return {
        mode,
        score,
        reason: readString(parsed.reason, "model-route"),
        signals: readStringArray(parsed.signals),
        needsReflectionCandidate: parsed.needsReflectionCandidate === true,
        workers: readWorkers(parsed.workers, mode),
        raw,
    };
}

function parseJsonObject(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u)?.[1]?.trim();
    const source = fenced ?? trimmed;
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end < start) {
        throw new Error("Blackboard route model did not return a JSON object.");
    }
    const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Blackboard route model returned invalid JSON.");
    }
    return parsed as Record<string, unknown>;
}

function readMode(value: unknown): BlackboardMode {
    if (
        value === BlackboardMode.Direct ||
        value === BlackboardMode.DirectWithWatch ||
        value === BlackboardMode.Blackboard
    ) {
        return value;
    }
    throw new Error(`Blackboard route model returned unsupported mode: ${String(value)}`);
}

function readScore(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Blackboard route model returned invalid score: ${String(value)}`);
    }
    return value;
}

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readWorkers(value: unknown, mode: BlackboardMode): BlackboardWorkerPlanInput[] {
    if (mode !== BlackboardMode.Blackboard) {
        return [];
    }
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error("Blackboard route model must return workers for blackboard mode.");
    }
    return value.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error(`Blackboard worker plan item ${index + 1} is invalid.`);
        }
        const candidate = item as Record<string, unknown>;
        const role = readString(candidate.role, "");
        if (!role) {
            throw new Error(`Blackboard worker plan item ${index + 1} is missing role.`);
        }
        return {
            capabilities: readStringArray(candidate.capabilities),
            dependsOn: readStringArray(candidate.dependsOn),
            handoff: readHandoff(candidate.handoff),
            name: readString(candidate.name, role),
            role,
            stage: readString(candidate.stage, `worker-${index + 1}`),
        };
    });
}

function readHandoff(value: unknown): BlackboardWorkerPlanInput["handoff"] | undefined {
    if (
        value === "analysis" ||
        value === "implementation" ||
        value === "proposal" ||
        value === "review" ||
        value === "structure" ||
        value === "summary" ||
        value === "verification"
    ) {
        return value;
    }
    return undefined;
}
