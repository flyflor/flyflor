import type { ConfigService } from '@/configuration';
import { Config, Provide } from '@/core/decorator';
import type { SocketPacket } from './packet';
import { Observable } from '@/core/ioc';
import { isAbsolute, resolve } from 'node:path';

/**
 * EN: Inbound IPC action handlers. FSocket reflects each non-user packet's
 * action name onto a same-named method here, so adding a public method
 * extends the socket protocol.
 * ZH: 入站 IPC action 处理器。FSocket 会把非用户类包的 action 名反射到本类
 * 同名方法上，因此新增 public 方法即扩展 socket 协议。
 */
@Provide()
export class Controller extends Observable {
    /** EN: Runtime configuration injected from the IOC container. ZH: 由 IOC 容器注入的运行时配置。 */
    @Config()
    public config!: ConfigService;

    /**
     * EN: Reflective dispatch entry: routes a packet to the method named by
     * its action; unknown actions are silently ignored.
     * ZH: 反射派收入口：把包路由到其 action 同名的方法；未知 action 静默忽略。
     */
    public dispatch({ action, data }: SocketPacket): void {
        const key = action as keyof Controller;
        const method = this[key] as unknown as ((arg: unknown) => unknown) | undefined;
        if (typeof method === 'function') method.call(this, data);
    }

    /**
     * EN: `cwd` action: re-roots the configured working directory, resolving
     * relative paths against the current one.
     * ZH: `cwd` action：重设配置中的工作目录，相对路径按当前目录解析。
     */
    public async cwd({ path }: { path: string }) {
        this.log.debug('cwd', path);
        const base = this.config.path.cwd;
        this.config.path.cwd = isAbsolute(path) ? resolve(path) : resolve(base, path);
        return true;
    }
}
