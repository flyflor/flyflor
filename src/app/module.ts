import { FModule, Module } from '@/core';
import { Synapse } from '@/neural';

/**
 * The root Flyflor module.
 * Imports the runtime transport layer and the external capability boundary used by the active agent.
 */
@Module({
    imports: [Synapse],
})
/**
 * EN: AppModule class declaration.
 * ZH: AppModule class 声明。
 */
export class AppModule extends FModule {}
