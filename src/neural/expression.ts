import type { CompleteSignal, ReplySignal } from '@/agent';
import { Init, Inject, Observable, Provide } from '@/core';
import { FSocket } from '@/transport';
import type { ExpressionSignal } from './types';

/** ZH: 投影回复与最终完成状态的有序皮层表达回路。 EN: Ordered cortical expression circuit projecting replies and terminal completion. */
@Provide()
export class Expression extends Observable<ExpressionSignal, ExpressionSignal> {
    @Inject()
    public socket!: FSocket;

    /** ZH: 一次性连接回复与 Complete 投影分支。 EN: Wires reply and Complete projection branches once. */
    @Init()
    public init(): void {
        this.switch('type', {
            reply: (signal) => this.reply(signal),
            complete: (signal) => this.complete(signal),
        });
    }

    /** ZH: 输出一个有序、用户可见的回复片段。 EN: Emits one ordered user-visible reply chunk. */
    private reply(signal: ReplySignal): ReplySignal {
        if (signal.chunk.length === 0) throw Error('Reply chunk is empty');
        this.socket.write({ action: 'agent', data: signal.chunk });
        return signal;
    }

    /** ZH: 在结束响应流前输出一个终态摘要。 EN: Emits one terminal summary before ending the response stream. */
    private complete(signal: CompleteSignal): CompleteSignal {
        this.socket.write({ action: 'complete', data: signal });
        this.socket.write({ action: 'streamEnd', data: true });
        return signal;
    }
}
