/**
 * Compatibility entry for the old ASK parser filename.
 *
 * New code should import from `parser.ts` or `component.ts`; this file keeps
 * existing public imports stable while Phase 3 moves ownership into AskComponent.
 */

export * from "./parser.ts";
