import { FModule, Module } from '@/core';
import { Synapse } from '@/neural';

/**
 * ZH: 描述持续存活应用依赖图的根 module。
 * EN: Root module describing the continuously living application graph.
 */
@Module({ imports: [Synapse] })
export class AppModule extends FModule {}
