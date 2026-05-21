/**
 * Blackboard scope key builder.
 *
 * Runtime no longer binds long-lived continuity to transport tuples. Without an
 * explicit scope, blackboard isolation falls back to the current request only.
 */

import type { RuntimeContext } from "../../../protocol/contracts/index.ts";
import { Component } from "../../../agent/di/decorators/index.ts";
import { Runtime } from "../../../components/component.ts";

@Component()
export class ScopeConstraintBuilder extends Runtime {
    public scopeConstraintIdForContext(context: RuntimeContext): string {
        return context.activeScope?.id ?? `turn:${context.requestId}`;
    }
}

const defaultScopeConstraintBuilder = new ScopeConstraintBuilder();

export function scopeConstraintIdForContext(context: RuntimeContext): string {
    return defaultScopeConstraintBuilder.scopeConstraintIdForContext(context);
}
