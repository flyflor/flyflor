import { Module } from "../di";
import { TemplateLoaderComponent } from "./template-loader.component";
import { ConfigService } from "./config.service";

/**
 * Assembles configuration-related providers for the Flyflor runtime.
 *
 * @usage Runtime modules import this to load `.config/config.jsonc` and `.config/templates`.
 */
@Module({
  providers: [ConfigService, TemplateLoaderComponent],
  exports: [ConfigService, TemplateLoaderComponent],
})
export class ConfigModule {}
