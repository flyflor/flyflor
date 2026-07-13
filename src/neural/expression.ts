import type { CompleteSignal, ReplySignal } from '@/agent';
import { Init, Inject, Observable, Provide } from '@/core';
import { FSocket } from '@/transport';
import type { ExpressionSignal } from './types';

/** EN: Ordered cortical expression circuit projecting replies and terminal completion. ZH: 投影回复与最终完成状态的有序皮层表达回路。 */
@Provide()
export class Expression extends Observable<ExpressionSignal> {
    @Inject()
    public socket!: FSocket;

    /** EN: Wires reply and Complete projection branches once. ZH: 一次性连接回复与 Complete 投影分支。 */
    @Init()
    public init(): void {
        this.switch<ExpressionSignal['type'], ExpressionSignal>((signal) => signal.type, {
            reply: (signal) => this.reply(signal as ReplySignal),
            complete: (signal) => this.complete(signal as CompleteSignal),
        });
    }

    /** EN: Emits one ordered user-visible reply chunk. ZH: 输出一个有序、用户可见的回复片段。 */
    private reply(signal: ReplySignal): ReplySignal {
        if (signal.chunk.length === 0) throw Error('Reply chunk is empty');
        this.socket.write({ action: 'agent', data: signal.chunk });
        return signal;
    }

    /** EN: Emits one terminal summary before ending the response stream. ZH: 在结束响应流前输出一个终态摘要。 */
    private complete(signal: CompleteSignal): CompleteSignal {
        this.socket.write({ action: 'complete', data: signal });
        this.socket.write({ action: 'streamEnd', data: true });
        return signal;
    }
}
