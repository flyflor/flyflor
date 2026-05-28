import {
    BlackboardMode,
    RuntimeMainRouteMode,
    type RuntimeMainRouteMode as RuntimeMainRouteModeType,
} from "../../../protocol/contracts/index.ts";
import type { RuntimeBlackboardRouteDecision } from "../blackboard/route.ts";
import {
    RouteEscalationPolicy,
    type RouteEscalationDecision,
    type RouteEscalationInput,
} from "./route.escalation.ts";

export interface ThinkingRouteDecision {
    blackboard: RuntimeBlackboardRouteDecision;
    escalation?: RouteEscalationDecision;
    mainRoute: RuntimeMainRouteModeType;
}

/**
 * Owner for the new two-level route contract.
 *
 * `fast | thinking` is the cognitive main route. The legacy BlackboardMode
 * remains the wire-compatible execution detail: direct is fast, while
 * direct-with-watch and blackboard are thinking, with blackboard as an
 * escalation inside thinking rather than a peer top-level route.
 */
export class ThinkingRoutePolicy {
    public constructor(private readonly escalation: RouteEscalationPolicy = new RouteEscalationPolicy()) {}

    public mainRouteFor(route: RuntimeBlackboardRouteDecision | undefined): RuntimeMainRouteModeType {
        if (!route) return RuntimeMainRouteMode.Fast;
        if (route.mode === BlackboardMode.Direct) return RuntimeMainRouteMode.Fast;
        return RuntimeMainRouteMode.Thinking;
    }

    public applyEscalation(
        route: RuntimeBlackboardRouteDecision | undefined,
        input: RouteEscalationInput,
    ): ThinkingRouteDecision | undefined {
        if (!route) return undefined;
        const decision = this.escalation.decide(input);
        if (!decision.escalated) {
            return {
                blackboard: route,
                mainRoute: this.mainRouteFor(route),
            };
        }
        return {
            blackboard: {
                ...route,
                mode: decision.targetMode,
                reason: `thinking-escalation:${decision.reason}`,
                signals: [...route.signals, "thinking-escalation", decision.reason],
                raw: JSON.stringify({
                    previousMode: route.mode,
                    reason: decision.reason,
                    targetMode: decision.targetMode,
                }),
            },
            escalation: decision,
            mainRoute: RuntimeMainRouteMode.Thinking,
        };
    }
}

export const thinkingRoutePolicy = new ThinkingRoutePolicy();
