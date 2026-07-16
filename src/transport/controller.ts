import type { ConfigService } from '@/config';
import { Config, Provide } from '@/core/decorator';
import type { SocketPacket } from './packet';
import { FService } from '@/core/ioc';

/**
 * ZH: 将非神经 transport 控制包派发到自身动作。
 * EN: Dispatches non-neural transport control packets to owned actions.
 */
@Provide()
export class Controller extends FService {
    @Config()
    public config!: ConfigService;

    /** ZH: 调用一个显式命名的 transport 动作。 EN: Invokes one explicitly named transport action. */
    public async dispatch({ action, data }: SocketPacket): Promise<void> {
        if (action !== 'cwd') throw Error(`Unknown transport action: ${action}`);
        await this.cwd(data);
    }

    /** ZH: 更新已配置的语义工作目录。 EN: Updates the configured semantic working directory. */
    public async cwd(data: unknown): Promise<void> {
        if (typeof data !== 'object' || data === null || Array.isArray(data)) throw Error('Invalid cwd transport packet');
        const path = (data as { path?: unknown }).path;
        if (typeof path !== 'string' || path.length === 0) throw Error('Invalid cwd transport packet');
        this.config.changeWorkingDirectory(path);
    }
}
