/**
 * Explicit Scope solidification owner.
 *
 * Cluster candidates only become durable Scope records after an ASK carries a
 * structured confirmation choice back into this component. The component never
 * inspects free-form answer text, and it never derives continuity from
 * transport/user/thread metadata.
 */

import { join } from "node:path";
import type { BrainStore } from "../memory/brain/store.ts";
import { AskReason, type AgentAsk, type RuntimeScope, type ScopeRecord } from "../../../protocol/contracts/index.ts";
import { ScopeScaffolder } from "./scaffolder.ts";
import { ScopeTriggerKind, type ScopeTriggerResult } from "./triggers.ts";

export const ScopeSolidificationDecision = {
    Create: "create-scope",
    Decline: "decline-scope",
} as const;
export type ScopeSolidificationDecision = (typeof ScopeSolidificationDecision)[keyof typeof ScopeSolidificationDecision];

export interface ScopeSolidificationOffer {
    ownerKey: string;
    scopeId: string;
    title: string;
    goal: string;
    triggerKind: ScopeTriggerKind;
    evidenceScore: number;
    relatedIds: string[];
    proposedAt: string;
}

export interface ScopeSolidificationConfirmation {
    decision: ScopeSolidificationDecision;
    scopeId: string;
    confirmedAt?: string;
    sourceKey?: string;
    title?: string;
    goal?: string;
}

export interface ScopeSolidificationResult {
    created: boolean;
    rationale: string;
    activeScope?: RuntimeScope;
    record?: ScopeRecord;
}

export class ScopeSolidificationComponent {
    /**
     * ASK payload used by runtime/UI layers. Confirmation remains a structured
     * choice value; later creation must receive that value explicitly.
     */
    public buildCreationAsk(offer: ScopeSolidificationOffer): AgentAsk {
        return {
            reason: AskReason.PolicyDecision,
            prompt: "Create this as an explicit Scope?",
            freeform: false,
            relatedIds: [offer.scopeId, ...offer.relatedIds].slice(0, 12),
            rationale: offer.triggerKind,
            choices: [
                {
                    label: "Create Scope",
                    value: ScopeSolidificationDecision.Create,
                    description: offer.title,
                },
                {
                    label: "Skip",
                    value: ScopeSolidificationDecision.Decline,
                    description: "Do not create a durable Scope for this candidate.",
                },
            ],
            continuationHint: {
                title: offer.title,
                contextHint: offer.goal,
            },
        };
    }

    public async solidifyConfirmedOffer(
        brain: BrainStore,
        scaffolder: ScopeScaffolder,
        offer: ScopeSolidificationOffer,
        confirmation: ScopeSolidificationConfirmation,
    ): Promise<ScopeSolidificationResult> {
        if (confirmation.decision !== ScopeSolidificationDecision.Create) {
            return { created: false, rationale: "declined" };
        }
        if (confirmation.scopeId !== offer.scopeId) {
            return { created: false, rationale: "scope-mismatch" };
        }

        const nowMs = this.confirmedAtMs(confirmation.confirmedAt);
        const createdAt = new Date(nowMs).toISOString();
        const existing = brain.getScope(offer.scopeId);
        const title = confirmation.title?.trim() || offer.title;
        const goal = confirmation.goal?.trim() || offer.goal;
        const trigger = this.triggerForOffer(offer);
        const scaffolded = await scaffolder.scaffold({
            scopeId: offer.scopeId,
            title,
            goal,
            sourceKey: confirmation.sourceKey ?? offer.ownerKey,
            trigger,
            createdAt,
        });
        const record = brain.upsertScope({
            id: offer.scopeId,
            title,
            goal,
            projectDir: scaffolded.projectDir,
            projectMemoryDir: join(scaffolded.projectDir, ".flyflor", "memory"),
            createdAt: existing?.createdAt ?? nowMs,
            updatedAt: nowMs,
            lastUsedAt: nowMs,
            useCount: (existing?.useCount ?? 0) + 1,
        });
        return {
            created: true,
            rationale: trigger.rationale,
            activeScope: {
                id: record.id,
                title: record.title,
                projectDir: record.projectDir,
                projectMemoryDir: record.projectMemoryDir,
            },
            record,
        };
    }

    private triggerForOffer(offer: ScopeSolidificationOffer): ScopeTriggerResult {
        return {
            kind: offer.triggerKind,
            score: Math.max(0, Math.min(1, offer.evidenceScore)),
            relatedIds: offer.relatedIds.slice(0, 16),
            rationale: "ask-confirmed-scope-offer",
        };
    }

    private confirmedAtMs(confirmedAt?: string): number {
        if (!confirmedAt) return Date.now();
        const parsed = Date.parse(confirmedAt);
        return Number.isFinite(parsed) ? parsed : Date.now();
    }
}

