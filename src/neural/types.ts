import type { AskResponse, AskSignal, CompleteSignal, ConfirmResponse, ConfirmSignal, ReplySignal } from '@/agent';

/** ZH: 共享串行用户交互回路的信号。 EN: Signals sharing the serial user-interaction circuit. */
export type InteractionSignal = AskSignal | ConfirmSignal;

/** ZH: 串行用户交互回路返回的响应。 EN: Responses returned by the serial user-interaction circuit. */
export type InteractionResponse = AskResponse | ConfirmResponse;

/** ZH: 共享有序用户表达回路的信号。 EN: Signals sharing the ordered user-expression circuit. */
export type ExpressionSignal = ReplySignal | CompleteSignal;
