import { FModule, Module } from '@/core';

/**
 * The guard module: permission/policy subscribers that consult capillary decisions (Confirm / ASK / sandbox).
 * Discovered via `listModule(FGuard)` and wired to the capillary layer at startup.
 * Early-dev: no guards registered, all consultations auto-Allow (rule 8 pass-through).
 */
@Module()
export class GuardModule extends FModule {}
