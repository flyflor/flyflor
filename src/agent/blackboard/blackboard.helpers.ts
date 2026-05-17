import type { BlackboardDiscussionPlan, BlackboardTurn, BlackboardWorkerState } from "./types.ts";
import { blackboardComposition } from "./blackboard.composition.ts";

/**
 * Backward-compatible public facade for older imports.
 *
 * New internal code should call `blackboardComposition` directly so blackboard
 * scheduling logic has one OOP owner.
 */
export function buildBlackboardPlan(goal: string, workers: BlackboardWorkerState[] = []): BlackboardDiscussionPlan {
    return blackboardComposition.buildBlackboardPlan(goal, workers);
}

/**
 * Backward-compatible public facade for older imports.
 *
 * Kept as a thin wrapper only; policy implementation belongs to
 * `BlackboardComposition`.
 */
export function convergencePolicyFor(turnOrGoal: BlackboardTurn | string): { forceHardCap: boolean; reason: string } {
    return blackboardComposition.convergencePolicyFor(turnOrGoal);
}
