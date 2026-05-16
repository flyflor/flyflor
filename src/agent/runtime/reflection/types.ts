import type { CrystalCandidateInput } from "../../../crystal/reflection/index.ts";
import { BlackboardMode, ModelRole, type ModelClient, type ModelMessage } from "../../../protocol/contracts/index.ts";
import { renderCrystalReflectionPrompt } from "../../prompts/index.ts";
import {
    normalizeReflectionRaw,
    renderReflectionEvidence as renderReflectionEvidenceShared,
    type ReflectionNormalizeSource,
} from "./normalize.ts";
import type { ReflectionThreadRunner } from "./thread.runner.ts";
import type { RuntimeBlackboardRouteDecision } from "../blackboard/route.ts";

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
        resultSummaryMeta?: Record<string, unknown>;
        server: string;
        tool: string;
    }>;
    skillNames?: string[];
}

export async function extractRuntimeReflectionCandidates(
    model: ModelClient,
    source: RuntimeReflectionSource,
    runner?: ReflectionThreadRunner,
): Promise<CrystalCandidateInput[]> {
    const normalizeSource = toNormalizeSource(source);
    const evidenceText = renderReflectionEvidenceShared(normalizeSource);
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
    if (runner) {
        return runner.normalize(raw, normalizeSource);
    }
    return normalizeReflectionRaw(raw, normalizeSource);
}

function toNormalizeSource(source: RuntimeReflectionSource): ReflectionNormalizeSource {
    return {
        answer: source.answer,
        blackboard: source.blackboard,
        now: source.now,
        request: source.request,
        requestId: source.requestId,
        route: source.route
            ? {
                  mode: source.route.mode,
                  reason: source.route.reason,
                  score: source.route.score,
                  signals: source.route.signals,
              }
            : undefined,
        mcpCalls: source.mcpCalls,
        skillNames: source.skillNames,
    };
}
