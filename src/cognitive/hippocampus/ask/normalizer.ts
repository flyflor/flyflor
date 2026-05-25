import { Component } from "../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../components/index.ts";
import type {
    AgentAsk,
    AgentAskChoice,
    AgentAskQuestion,
    AskAuthority,
    AskCrystalCandidatePolicy,
    AskReason,
    AskResumePolicy,
    AskSource,
} from "../../../protocol/contracts/index.ts";
import {
    AskAuthority as AskAuthorityEnum,
    AskCrystalCandidatePolicy as AskCrystalCandidatePolicyEnum,
    AskReason as AskReasonEnum,
    AskResumePolicy as AskResumePolicyEnum,
    AskSource as AskSourceEnum,
} from "../../../protocol/contracts/index.ts";
import { AskPolicyComponent, askPolicyComponent } from "./policy.ts";

const VALID_REASONS: ReadonlySet<string> = new Set(Object.values(AskReasonEnum));
const VALID_AUTHORITIES: ReadonlySet<string> = new Set(Object.values(AskAuthorityEnum));
const VALID_SOURCES: ReadonlySet<string> = new Set(Object.values(AskSourceEnum));
const VALID_RESUME_POLICIES: ReadonlySet<string> = new Set(Object.values(AskResumePolicyEnum));
const VALID_CRYSTAL_POLICIES: ReadonlySet<string> = new Set(Object.values(AskCrystalCandidatePolicyEnum));
const MAX_ASK_QUESTIONS = 5;
const MAX_ROOT_CHOICES = 12;
const MAX_MODEL_CHOICES_PER_QUESTION = 3;

/**
 * ASK normalizer validates structured payloads and applies presentation-safe defaults.
 *
 * It clips model-provided option arrays, adds stable choice ids, and keeps the
 * fixed `other` escape hatch on every structured question.
 */
@Component()
export class AskNormalizer extends MemoryComponent {
    public constructor(private readonly policy: AskPolicyComponent = askPolicyComponent) {
        super();
    }

    public normalizePayload(payload: unknown): AgentAsk {
        if (!payload || typeof payload !== "object") {
            throw new Error("agent_question must be a JSON object.");
        }
        const obj = payload as Record<string, unknown>;
        const reason = this.normalizeReason(obj.reason);
        if (!reason) throw new Error(`agent_question has invalid reason: ${String(obj.reason)}`);
        const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
        if (!prompt) throw new Error("agent_question requires non-empty prompt.");
        const choices = this.normalizeChoices(obj.choices, MAX_ROOT_CHOICES);
        const questions = this.normalizeQuestions(obj.questions);
        const freeform = typeof obj.freeform === "boolean" ? obj.freeform : true;
        const relatedIds = this.normalizeStringArray(obj.relatedIds);
        const rationale = typeof obj.rationale === "string" ? obj.rationale.trim().slice(0, 500) : undefined;
        const continuationHint = this.normalizeContinuationHint(obj.continuationHint);
        const hasStructuredChoices =
            (choices?.length ?? 0) > 0 || (questions?.some((question) => (question.choices?.length ?? 0) > 0) ?? false);
        if (!freeform && !hasStructuredChoices) {
            throw new Error("agent_question with freeform=false requires at least one structured choice.");
        }
        if (questions?.some((question) => question.freeform === false && (question.choices?.length ?? 0) === 0)) {
            throw new Error("agent_question question with freeform=false requires structured choices.");
        }
        const ask: AgentAsk = {
            reason,
            prompt: prompt.slice(0, 2000),
            freeform,
        };
        const authority = this.normalizeAuthority(obj.authority);
        const source = this.normalizeSource(obj.source);
        const resumePolicy = this.normalizeResumePolicy(obj.resumePolicy);
        if (authority) ask.authority = authority;
        if (source) ask.source = source;
        if (resumePolicy) ask.resumePolicy = resumePolicy;
        if (choices && choices.length > 0) ask.choices = choices;
        if (questions && questions.length > 0) ask.questions = questions;
        if (relatedIds && relatedIds.length > 0) ask.relatedIds = relatedIds;
        if (rationale) ask.rationale = rationale;
        if (continuationHint) ask.continuationHint = continuationHint;
        return this.policy.normalize(ask);
    }

    private normalizeContinuationHint(value: unknown): { title: string; contextHint?: string } | undefined {
        if (!value || typeof value !== "object") {
            return undefined;
        }
        const obj = value as Record<string, unknown>;
        const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 120) : undefined;
        const contextHint = typeof obj.contextHint === "string" ? obj.contextHint.trim().slice(0, 500) : undefined;
        if (!title) {
            return undefined;
        }
        const out: { title: string; contextHint?: string } = { title };
        if (contextHint) out.contextHint = contextHint;
        return out;
    }

    private normalizeReason(value: unknown): AskReason | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!VALID_REASONS.has(trimmed)) return undefined;
        return trimmed as AskReason;
    }

    private normalizeAuthority(value: unknown): AskAuthority | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!VALID_AUTHORITIES.has(trimmed)) return undefined;
        return trimmed as AskAuthority;
    }

    private normalizeSource(value: unknown): AskSource | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!VALID_SOURCES.has(trimmed)) return undefined;
        return trimmed as AskSource;
    }

    private normalizeResumePolicy(value: unknown): AskResumePolicy | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!VALID_RESUME_POLICIES.has(trimmed)) return undefined;
        return trimmed as AskResumePolicy;
    }

    private normalizeCrystalCandidatePolicy(value: unknown): AskCrystalCandidatePolicy | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!VALID_CRYSTAL_POLICIES.has(trimmed)) return undefined;
        return trimmed as AskCrystalCandidatePolicy;
    }

    private normalizeChoices(value: unknown, limit: number): AgentAskChoice[] | undefined {
        if (!Array.isArray(value)) return undefined;
        const out: AgentAskChoice[] = [];
        for (const raw of value) {
            if (!raw || typeof raw !== "object") continue;
            const obj = raw as Record<string, unknown>;
            const label = typeof obj.label === "string" ? obj.label.trim().slice(0, 200) : "";
            if (!label) continue;
            const choice: AgentAskChoice = { label };
            if (typeof obj.id === "string" && obj.id.trim()) choice.id = obj.id.trim().slice(0, 100);
            if (typeof obj.value === "string" && obj.value.trim()) choice.value = obj.value.trim().slice(0, 200);
            if (typeof obj.description === "string" && obj.description.trim()) {
                choice.description = obj.description.trim().slice(0, 500);
            }
            if (typeof obj.recommended === "boolean") choice.recommended = obj.recommended;
            if (this.isRecord(obj.executionPatch)) choice.executionPatch = this.cloneJsonObject(obj.executionPatch);
            out.push(choice);
            if (out.length >= limit) break;
        }
        return out;
    }

    private normalizeQuestions(value: unknown): AgentAskQuestion[] | undefined {
        if (!Array.isArray(value)) return undefined;
        const out: AgentAskQuestion[] = [];
        for (const raw of value) {
            if (!raw || typeof raw !== "object") continue;
            const obj = raw as Record<string, unknown>;
            const prompt = typeof obj.prompt === "string" ? obj.prompt.trim().slice(0, 500) : "";
            if (!prompt) continue;
            const question: AgentAskQuestion = { prompt };
            if (typeof obj.id === "string" && obj.id.trim()) question.id = obj.id.trim().slice(0, 100);
            const choices = this.normalizeChoices(obj.choices, MAX_MODEL_CHOICES_PER_QUESTION);
            if (choices && choices.length > 0) {
                question.choices = choices.map((choice, index) => ({
                    ...choice,
                    id: choice.id ?? `choice-${index + 1}`,
                }));
                const recommended = this.normalizeRecommendedChoiceId(obj.recommendedChoiceId, question.choices);
                question.recommendedChoiceId = recommended ?? question.choices[0]?.id;
                question.other = { id: "other", label: "其他", freeform: true };
                question.allowOther = true;
            }
            if (typeof obj.freeform === "boolean") question.freeform = obj.freeform;
            const relatedIds = this.normalizeStringArray(obj.relatedIds);
            if (relatedIds && relatedIds.length > 0) question.relatedIds = relatedIds;
            if (typeof obj.rationale === "string" && obj.rationale.trim()) {
                question.rationale = obj.rationale.trim().slice(0, 500);
            }
            const crystalCandidatePolicy = this.normalizeCrystalCandidatePolicy(obj.crystalCandidatePolicy);
            if (crystalCandidatePolicy) question.crystalCandidatePolicy = crystalCandidatePolicy;
            out.push(question);
            if (out.length >= MAX_ASK_QUESTIONS) break;
        }
        return out;
    }

    private normalizeRecommendedChoiceId(value: unknown, choices: readonly AgentAskChoice[]): string | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        return choices.some((choice) => choice.id === trimmed) ? trimmed : undefined;
    }

    private normalizeStringArray(value: unknown): string[] | undefined {
        if (!Array.isArray(value)) return undefined;
        const out: string[] = [];
        for (const raw of value) {
            if (typeof raw !== "string") continue;
            const trimmed = raw.trim();
            if (trimmed) out.push(trimmed.slice(0, 200));
            if (out.length >= 16) break;
        }
        return out;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    private cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
        return structuredClone(value) as Record<string, unknown>;
    }
}

export const askNormalizer = new AskNormalizer();
