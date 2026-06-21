import type { ConfigService } from '@/configuration';
import { Config, Provide } from '@/core/decorator';
import type { SocketPacket } from './packet';
import { Observable } from '@/core/ioc';

@Provide()
export class Controller extends Observable {
    @Config()
    public config!: ConfigService;

    public dispatch({ action, data }: SocketPacket): void {
        const key = action as keyof Controller;
        const method = this[key] as unknown as ((arg: unknown) => unknown) | undefined;
        if (typeof method === 'function') method.call(this, data);
    }

    public async cwd({ path }: { path: string }) {
        this.log.debug('cwd', path);
        this.config.path.cwd = path;
        return true;
    }
}
