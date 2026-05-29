import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { MemoryModule } from "../memory";
import { ContextBuilderService } from "./context-builder.service";
import { ContextCompressorComponent } from "./context-compressor.component";

/**
 * Assembles no-session context construction capabilities.
 *
 * @usage KernelModule imports this module to rebuild model input for every turn.
 */
@Module({
  imports: [ConfigModule, MemoryModule],
  providers: [ContextBuilderService, ContextCompressorComponent],
  exports: [ContextBuilderService, ContextCompressorComponent],
})
export class ContextModule {}
