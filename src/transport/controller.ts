import type { ConfigService } from '@/config';
import { Config, Provide } from '@/core/decorator';
import type { SocketPacket } from './packet';
import { FService } from '@/core/ioc';
import { isAbsolute, resolve } from 'node:path';

/**
 * EN: Dispatches non-neural transport control packets to owned actions.
 * ZH: 将非神经 transport 控制包派发到自身动作。
 */
@Provide()
export class Controller extends FService {
    @Config()
    public config!: ConfigService;

    /** EN: Invokes one explicitly named transport action. ZH: 调用一个显式命名的 transport 动作。 */
    public async dispatch({ action, data }: SocketPacket): Promise<void> {
        const key = action as keyof Controller;
        const method = this[key] as unknown as ((arg: unknown) => unknown | Promise<unknown>) | undefined;
        if (typeof method !== 'function') throw Error(`Unknown transport action: ${action}`);
        await method.call(this, data);
    }

    /** EN: Updates the configured semantic working directory. ZH: 更新已配置的语义工作目录。 */
    public async cwd({ path }: { path: string }) {
        const base = this.config.path.cwd;
        this.config.path.cwd = isAbsolute(path) ? resolve(path) : resolve(base, path);
        return true;
    }
}
