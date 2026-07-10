import type { ConfigService } from '@/config';
import { Config, Provide } from '@/core/decorator';
import type { SocketPacket } from './packet';
import { FService } from '@/core/ioc';
import { isAbsolute, resolve } from 'node:path';

@Provide()
/**
 * EN: Controller class declaration.
 * ZH: Controller class 声明。
 */
export class Controller extends FService {
    @Config()
    public config!: ConfigService;

    public dispatch({ action, data }: SocketPacket): void {
        const key = action as keyof Controller;
        const method = this[key] as unknown as ((arg: unknown) => unknown) | undefined;
        if (typeof method === 'function') method.call(this, data);
    }

    public async cwd({ path }: { path: string }) {
        this.log.debug('cwd', path);
        const base = this.config.path.cwd;
        this.config.path.cwd = isAbsolute(path) ? resolve(path) : resolve(base, path);
        return true;
    }
}
