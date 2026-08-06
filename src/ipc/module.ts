import { FModule, Module } from '@/core';
import { FSocket } from './socket';

@Module({ imports: [FSocket] })
export class IPCModule extends FModule {}
