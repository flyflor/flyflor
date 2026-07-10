import type { AskResponse, AskSignal, CompleteSignal, ConfirmResponse, ConfirmSignal, TaskSignal } from '@/agent/types';
import type { ContextBrief } from '@/agent/context';

/** EN: One complete Investigation invocation. ZH: 一次完整 Investigation 调用。 */
export interface InvestigationRequest {
    id: string;
    turnId: string;
    goal: string;
    context: ContextBrief;
    delegation: boolean;
    visible: boolean;
}

/** EN: Signals wired by one persistent Investigation network. ZH: 一张持久 Investigation 网络连接的信号。 */
export type InvestigationSignal = AskSignal | ConfirmSignal | TaskSignal | CompleteSignal;

/** EN: Results produced by the four Investigation branches. ZH: 四条 Investigation 分支产生的结果。 */
export type InvestigationOutput = AskResponse | ConfirmResponse | CompleteSignal[] | CompleteSignal;
