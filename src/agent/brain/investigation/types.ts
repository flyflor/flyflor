import type { AskResponse, AskSignal, CompleteSignal, ConfirmResponse, ConfirmSignal, TaskSignal } from '@/agent/types';

/** ZH: 一次完整 Investigation 调用。 EN: One complete Investigation invocation. */
export interface InvestigationRequest {
    id: string;
    turnId: string;
    goal: string;
    cwd?: string;
    root: boolean;
}

/** ZH: 一张持久 Investigation 网络连接的信号。 EN: Signals wired by one persistent Investigation network. */
export type InvestigationSignal = AskSignal | ConfirmSignal | TaskSignal | CompleteSignal;

/** ZH: 四条 Investigation 分支产生的结果。 EN: Results produced by the four Investigation branches. */
export type InvestigationOutput = AskResponse | ConfirmResponse | CompleteSignal[] | CompleteSignal;
