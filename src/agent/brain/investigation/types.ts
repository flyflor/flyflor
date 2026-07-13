import type { ContextBrief } from '@/agent/context';

/**
 * EN: One Investigation invocation owned by Brain.
 * ZH: 由 Brain 发起的一次 Investigation 调用。
 *
 * EN: `root` replaces the old delegation/visible pair: root runs may list rootOnly tools
 * and stream reply chunks; delegated runs may not.
 * ZH: `root` 替代旧的 delegation/visible 双布尔：根运行可列 rootOnly 工具并流式 reply；
 * 委派运行不可。
 */
export interface InvestigationRequest {
    /** EN: Local run id (turn id for root, task id for delegated). ZH: 本地运行 id（根为 turn id，委派为 task id）。 */
    id: string;
    /** EN: Owning Context turn id. ZH: 所属 Context turn id。 */
    turnId: string;
    /** EN: Immutable experience brief for tools and prompts. ZH: 供工具与提示词使用的不可变经历 brief。 */
    context: ContextBrief;
    /** EN: True for the root person; false for delegated workers. ZH: 根人物为 true；委派 worker 为 false。 */
    root: boolean;
}
