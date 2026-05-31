import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { PromptRegistryService } from "./prompt.registry.service";

/**
 * Assembles the unified prompt protocol layer.
 *
 * @usage KernelModule imports this module so all services can load prompts through one registry.
 */
@Module({
  imports: [ConfigModule],
  providers: [PromptRegistryService],
  exports: [PromptRegistryService],
})
export class PromptsModule {}
