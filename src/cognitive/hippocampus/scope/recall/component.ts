import { Component } from "../../../../agent/di/decorators/index.ts";
import { renderScopeRecallPrompt } from "../../../../agent/prompts/index.ts";
import { Memory } from "../../../../components/component.ts";
import {
    AskReason,
    ModelRole,
    type AgentAsk,
    type ModelClient,
    type ModelMessage,
    type RuntimeContext,
    type ScopeRecord,
} from "../../../../protocol/contracts/index.ts";
import type { ScopeRecallCandidate } from "../../memory/types.ts";

export const ScopeRecallDecisionKind = {
    Ask: "ask",
    Load: "load",
    None: "none",
} as const;

export type ScopeRecallDecisionKind = (typeof ScopeRecallDecisionKind)[keyof typeof ScopeRecallDecisionKind];

export interface ScopeRecallDecision {
    decision: ScopeRecallDecisionKind;
    scope?: ScopeRecord;
    confidence: number;
    candidateScopeIds: string[];
    reason: string;
    ask?: AgentAsk;
    raw: string;
}

@Component()
export class ScopeRecallComponent extends Memory {
    public async decide(input: {
        candidates: ScopeRecallCandidate[];
        context: RuntimeContext;
        model: ModelClient;
        request: string;
        signal?: AbortSignal;
    }): Promise<ScopeRecallDecision> {
        if (input.context.activeScope || input.candidates.length === 0) {
            return this.none("explicit-scope-or-no-candidates");
        }
        const messages: ModelMessage[] = [
            {
                role: ModelRole.System,
                content: renderScopeRecallPrompt({
                    candidateJson: JSON.stringify(input.candidates.map((candidate) => this.promptCandidate(candidate)), null, 2),
                    currentContextJson: JSON.stringify(this.promptContext(input.context), null, 2),
                    request: input.request,
                }),
            },
            { role: ModelRole.User, content: input.request },
        ];
        const raw = await input.model.generate(messages, { signal: input.signal });
        return this.parse(raw, input.candidates);
    }

    public parse(raw: string, candidates: ScopeRecallCandidate[]): ScopeRecallDecision {
        const parsed = this.parseJsonObject(raw);
        const decision = this.readDecision(parsed.decision);
        const confidence = this.readConfidence(parsed.confidence);
        const candidateScopeIds = this.readScopeIds(parsed.candidateIds ?? parsed.candidateScopeIds, candidates);
        const reason = this.readString(parsed.reason) ?? "scope-recall";
        const scopeId = this.readString(parsed.contextId ?? parsed.scopeId);
        const scope = scopeId ? candidates.find((candidate) => candidate.scope.id === scopeId)?.scope : undefined;
        if (decision === ScopeRecallDecisionKind.Load && scope) {
            return { decision, scope, confidence, candidateScopeIds, reason, raw };
        }
        if (decision === ScopeRecallDecisionKind.Ask) {
            const askPrompt =
                this.readString(parsed.askPrompt) ??
                "I found more than one possible project scope. Which one should I use?";
            return {
                decision,
                confidence,
                candidateScopeIds,
                reason,
                raw,
                ask: {
                    reason: AskReason.CodenameAmbiguity,
                    prompt: askPrompt,
                    freeform: true,
                    relatedIds: candidateScopeIds,
                    rationale: reason,
                    choices: candidateScopeIds.map((id) => {
                        const candidate = candidates.find((item) => item.scope.id === id);
                        return {
                            label: candidate?.scope.title ?? id,
                            value: id,
                            description: candidate?.scope.goal ?? candidate?.vectorSummary,
                        };
                    }),
                    continuationHint: {
                        title: "Scope recall needs confirmation",
                        contextHint: askPrompt,
                    },
                },
            };
        }
        return { decision: ScopeRecallDecisionKind.None, confidence, candidateScopeIds, reason, raw };
    }

    private none(reason: string): ScopeRecallDecision {
        return {
            decision: ScopeRecallDecisionKind.None,
            confidence: 0,
            candidateScopeIds: [],
            reason,
            raw: "",
        };
    }

    private promptContext(context: RuntimeContext): Record<string, unknown> {
        return {
            requestId: context.requestId,
            hasExplicitScope: Boolean(context.activeScope),
            contextForkId: context.contextForkId,
            skillNames: context.skillNames ?? [],
        };
    }

    private promptCandidate(candidate: ScopeRecallCandidate): Record<string, unknown> {
        return {
            scope: {
                id: candidate.scope.id,
                title: candidate.scope.title,
                goal: candidate.scope.goal,
                projectDir: candidate.scope.projectDir,
                lastUsedAt: candidate.scope.lastUsedAt,
                useCount: candidate.scope.useCount,
            },
            codename: candidate.codename
                ? {
                      id: candidate.codename.id,
                      name: candidate.codename.name,
                      description: candidate.codename.description,
                      useCount: candidate.codename.useCount,
                  }
                : null,
            vector: candidate.vector
                ? {
                      score: candidate.vector.score,
                      summary: candidate.vector.summary,
                      evidence: candidate.vector.evidence,
                      relatedIds: candidate.vector.relatedIds,
                  }
                : null,
            vectorSummary: candidate.vectorSummary,
        };
    }

    private parseJsonObject(raw: string): Record<string, unknown> {
        const trimmed = raw.trim();
        const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u)?.[1]?.trim();
        const source = fenced ?? trimmed;
        const start = source.indexOf("{");
        const end = source.lastIndexOf("}");
        if (start < 0 || end < start) {
            throw new Error("Scope recall model did not return a JSON object.");
        }
        const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Scope recall model returned invalid JSON.");
        }
        return parsed as Record<string, unknown>;
    }

    private readDecision(value: unknown): ScopeRecallDecisionKind {
        if (
            value === ScopeRecallDecisionKind.None ||
            value === ScopeRecallDecisionKind.Load ||
            value === ScopeRecallDecisionKind.Ask
        ) {
            return value;
        }
        throw new Error(`Scope recall model returned unsupported decision: ${String(value)}`);
    }

    private readConfidence(value: unknown): number {
        if (typeof value !== "number" || !Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(1, value));
    }

    private readScopeIds(value: unknown, candidates: ScopeRecallCandidate[]): string[] {
        const allowed = new Set(candidates.map((candidate) => candidate.scope.id));
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is string => typeof item === "string" && allowed.has(item)).slice(0, 8);
    }

    private readString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
    }
}
