import { FService, Logger, Singleton, type FLogger } from '@/core';

@Singleton()
export class Context extends FService {
    @Logger(Context.name)
    public readonly log!: FLogger;
}
