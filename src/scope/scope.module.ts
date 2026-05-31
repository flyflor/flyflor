import { Module } from "../di";
import { MemoryModule } from "../memory";
import { SignalModule } from "../signal";
import { ConfigModule } from "../config/config.module";
import { ScopeStore } from "./scope.store.component";
import { ScopeService } from "./scope.service";

/**
 * Assembles the scope detection, persistence, and recall providers.
 *
 * Imports MemoryModule for vector embeddings and chunk access,
 * SignalModule for runtime event publication, and ConfigModule for
 * scope.db path resolution.
 *
 * @usage Import this module where scope-aware context building
 * or scope lifecycle management is required. When crystal ask
 * confirmation is needed, also import CrystalModule.
 */
@Module({
  imports: [MemoryModule, SignalModule, ConfigModule],
  providers: [ScopeStore, ScopeService],
  exports: [ScopeStore, ScopeService],
})
export class ScopeModule {}
