import { FModule, Module } from '@/core';
import { ConfigComponent } from './components/config';
import { MemoryComponent } from './components/memory';
import { ContextComponent } from './components/context';

/**
 * The state "shard": the agent's working-state slice — configuration, memory access, and live context.
 * Imports its components; base classes auto-classify them as stateful components in the DI tree.
 */
@Module({
    imports: [ConfigComponent, MemoryComponent, ContextComponent],
})
export class ShardModule extends FModule {}
