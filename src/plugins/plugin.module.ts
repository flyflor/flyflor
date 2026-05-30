import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { CodeGraphPlugin, RtkPlugin } from "./builtin.plugins";
import { ExternalCommandPluginComponent } from "./external.command.plugin.component";
import { PluginInstallerComponent } from "./plugin.installer.component";
import { PluginRegistryComponent } from "./plugin.registry.component";

/**
 * Assembles plugin host and built-in external plugin adapters.
 *
 * @usage KernelModule imports this module so optional CodeGraph and RTK integrations are discoverable.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    PluginRegistryComponent,
    PluginInstallerComponent,
    ExternalCommandPluginComponent,
    CodeGraphPlugin,
    RtkPlugin,
  ],
  exports: [
    PluginRegistryComponent,
    PluginInstallerComponent,
    ExternalCommandPluginComponent,
    CodeGraphPlugin,
    RtkPlugin,
  ],
})
export class PluginModule {}
