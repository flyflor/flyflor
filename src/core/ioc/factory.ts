import type { Ctor } from '@/core/decorator';
import type { FModule } from './abstracts';
import { useContainer } from './container';

/**
 * EN: Composition root that creates one continuously living Flyflor module graph.
 * ZH: 创建一套持续存活的 Flyflor module graph 的组合根。
 */
export class Factory {
    /**
     * EN: Resolves and initializes the complete graph rooted at one module.
     * ZH: 解析并初始化以一个 module 为根的完整依赖图。
     */
    public static async create<T extends Ctor<FModule>>(root: T): Promise<InstanceType<T>> {
        return await useContainer().getAsync(root);
    }
}
