import { FService, Service } from "@/core";

/**
 * The default single-agent router.
 *
 * Today Flyflor has one agent, so routing is intentionally direct: load the canonical agent prompt, send the
 * current user turn to the configured LLM, and record the observed input/output in the context shard for later
 * distillation work.
 */
@Service()
export class RouterService extends FService {}
