# Crystal Reflection

## Position

Crystal is crystallized intelligence: stable reusable knowledge, methods and Gems produced from evidence. It is distinct from hot Memory and from the ledger.

Code owners:

- `src/cognitive/crystal/memory/component.ts`
- `src/cognitive/crystal/memory/vector.index.ts`
- `src/cognitive/crystal/gems/component.ts`
- `src/cognitive/crystal/reflection/crystal.reflection.ts`
- `src/agent/runtime/reflection/worker.ts`

## Flow

1. Runtime and Memory create structured evidence from ASK answers, fork merges, blackboard convergence, task outcomes, replay records and reflection candidates.
2. Crystal reflection normalizes candidates and checks quality.
3. Stable candidates may become Gem knowledge.
4. Crystal recall later contributes stable methods or facts to context assembly.
5. Drift repair handles stale or contradictory crystallized knowledge.

Crystal promotion is not automatic transcript copying. A raw event count is not enough; candidates must carry useful evidence and quality.

## Relationship To Memory

Memory is hot and adaptive. Crystal is stable and reusable.

Memory can decay, compress and recall recent material. Crystal should preserve reusable methods or knowledge that survived evidence checks. The two layers can reference ledger provenance, but neither turns raw `brain.db` event rows directly into prompt context.

## Vector And Drift

Crystal vector logic supports recall and repair, not business intent routing. Tokenizer, hash, cosine and freshness logic belong to the crystal vector owner. Recall scores are resource metrics, not semantic keyword rules.

## Gem Boundary

A Gem is a crystallized reusable artifact. It can influence future prompts as stable knowledge, but it should not carry raw hidden conversation logs.

## Tests

Relevant coverage:

- `tests/crystal.local.backend.test.ts`
- `tests/reflection.boundaries.test.ts`
- `tests/reflection.gem.consolidation.test.ts`
- `tests/reflection.worker.test.ts`
