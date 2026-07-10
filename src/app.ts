import { FModule, Module } from '@/core';
import { Synapse } from '@/neural';

/**
 * EN: Root module describing the continuously living application graph.
 * ZH: 描述持续存活应用依赖图的根 module。
 */
@Module({ imports: [Synapse] })
export class AppModule extends FModule {}
