import {
    InteractionMode,
    ModelRole,
    PlanningRouteDecisionKind,
    type InteractionMode as InteractionModeType,
    type ModelClient,
    type ModelMessage,
    type PlanningRouteDecisionKind as PlanningRouteDecisionKindType,
} from "../../../protocol/contracts/index.ts";
import { Component } from "../../di/decorators/index.ts";
import { Runtime } from "../../../components/component.ts";
import { renderPlanningRoutePrompt } from "../../prompts/index.ts";

export interface RuntimePlanningRouteDecision {
    askPrompt?: string;
    confidence: number;
    decision: PlanningRouteDecisionKindType;
    planSummary?: string;
    planTitle?: string;
    raw: string;
    reason: string;
}

@Component()
export class RuntimePlanningRouteComponent extends Runtime {
    public async decide(input: {
        interactionMode: InteractionModeType;
        model: ModelClient;
        request: string;
        signal?: AbortSignal;
    }): Promise<RuntimePlanningRouteDecision> {
        const messages: ModelMessage[] = [
            {
                role: ModelRole.System,
                content: renderPlanningRoutePrompt({
                    interactionMode: input.interactionMode,
                    request: input.request,
                }),
            },
            {
                role: ModelRole.User,
                content: input.request,
            },
        ];
        const raw = await input.model.generate(messages, { signal: input.signal });
        return this.parse(raw, input.interactionMode);
    }

    public parse(raw: string, interactionMode: InteractionModeType = InteractionMode.Act): RuntimePlanningRouteDecision {
        const parsed = this.parseJsonObject(raw);
        const decision = this.readDecision(parsed.decision, interactionMode);
        return {
            askPrompt: this.readOptionalString(parsed.askPrompt, 800),
            confidence: this.readConfidence(parsed.confidence),
            decision,
            planSummary: this.readOptionalString(parsed.planSummary, 1200),
            planTitle: this.readOptionalString(parsed.planTitle, 160),
            raw,
            reason: this.readRequiredString(parsed.reason, "reason", 500),
        };
    }

    private readDecision(value: unknown, interactionMode: InteractionModeType): PlanningRouteDecisionKindType {
        if (
            value === PlanningRouteDecisionKind.Direct ||
            value === PlanningRouteDecisionKind.Plan ||
            value === PlanningRouteDecisionKind.Ask
        ) {
            if (interactionMode === InteractionMode.Plan && value === PlanningRouteDecisionKind.Direct) {
                return PlanningRouteDecisionKind.Plan;
            }
            return value;
        }
        throw new Error(`Planning route model returned unsupported decision: ${String(value)}`);
    }

    private parseJsonObject(raw: string): Record<string, unknown> {
        const trimmed = raw.trim();
        const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u)?.[1]?.trim();
        const source = fenced ?? trimmed;
        const start = source.indexOf("{");
        const end = source.lastIndexOf("}");
        if (start < 0 || end < start) {
            throw new Error("Planning route model did not return a JSON object.");
        }
        const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Planning route model returned invalid JSON.");
        }
        return parsed as Record<string, unknown>;
    }

    private readConfidence(value: unknown): number {
        if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
        return Math.max(0, Math.min(1, value));
    }

    private readOptionalString(value: unknown, max: number): string | undefined {
        return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
    }

    private readRequiredString(value: unknown, field: string, max: number): string {
        const text = this.readOptionalString(value, max);
        if (!text) throw new Error(`Planning route model returned invalid ${field}.`);
        return text;
    }
}
