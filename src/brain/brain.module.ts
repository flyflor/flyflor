import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { BrainComponent } from "./brain.component";

/**
 * Assembles the monthly full-fidelity brain audit layer.
 *
 * @usage KernelModule imports this module so turns, events, tools, and recovery points are durably recorded.
 */
@Module({
  imports: [ConfigModule],
  providers: [BrainComponent],
  exports: [BrainComponent],
})
export class BrainModule {}
