import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { MemoryModule } from "../memory";
import { ContextBuilderService } from "./context.builder.service";
import { ContextCompressorComponent } from "./context.compressor.component";
import { ContextIntentAnalyzerComponent } from "./context.intent.analyzer.component";

/**
 * Assembles no-session context construction capabilities.
 *
 * @usage KernelModule imports this module to rebuild model input for every turn.
 */
@Module({
  imports: [ConfigModule, MemoryModule],
  providers: [ContextBuilderService, ContextCompressorComponent, ContextIntentAnalyzerComponent],
  exports: [ContextBuilderService, ContextCompressorComponent, ContextIntentAnalyzerComponent],
})
export class ContextModule {}
