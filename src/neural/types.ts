import type { AskResponse, AskSignal, CompleteSignal, ConfirmResponse, ConfirmSignal, ReplySignal } from '@/agent';

/** EN: Signals sharing the serial user-interaction circuit. ZH: 共享串行用户交互回路的信号。 */
export type InteractionSignal = AskSignal | ConfirmSignal;

/** EN: Responses returned by the serial user-interaction circuit. ZH: 串行用户交互回路返回的响应。 */
export type InteractionResponse = AskResponse | ConfirmResponse;

/** EN: Signals sharing the ordered user-expression circuit. ZH: 共享有序用户表达回路的信号。 */
export type ExpressionSignal = ReplySignal | CompleteSignal;
