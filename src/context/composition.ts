import type { FlyflorPaths } from "../config/index.ts";
import { ContextScopeComponent } from "./context.scope.component.ts";

/**
 * Context composition entry. `use*` functions are the only place where this
 * module wires class components together; runtime code should consume the
 * returned Component instead of scattering raw helper functions.
 */
export function useContextScope(paths: FlyflorPaths): ContextScopeComponent {
    return new ContextScopeComponent(paths);
}
