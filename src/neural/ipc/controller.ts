import type { ConfigService } from '@/configuration';
import { Config, Logger, Provide, type FLogger } from '@/core';

@Provide()
export class Controller {
    @Config()
    public config!: ConfigService;

    @Logger()
    public readonly log!: FLogger;

    public async cwd({ path }: { path: string }) {
        this.log.debug('cwd', path);
        this.config.path.cwd = path;
        return true;
    }
}
