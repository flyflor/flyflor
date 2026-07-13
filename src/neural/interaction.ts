import type { AskResponse, ConfirmResponse } from '@/agent';
import { Context } from '@/agent';
import { Init, Inject, Observable, Provide } from '@/core';
import { FSocket } from '@/transport';
import type { InteractionResponse, InteractionSignal } from './types';

/** EN: Serial Ask and Confirm circuit owning the sole pending user interaction. ZH: 持有唯一待处理用户交互的串行 Ask 与 Confirm 回路。 */
@Provide()
export class Interaction extends Observable<InteractionSignal, InteractionResponse> {
    @Inject()
    public context!: Context;

    @Inject()
    public socket!: FSocket;

    private pending?: {
        signal: InteractionSignal;
        resolve: (response: InteractionResponse) => void;
    };

    /** EN: Creates an interaction circuit without a pending request. ZH: 创建一条没有待处理请求的交互回路。 */
    public constructor() {
        super();
        this.pending = undefined;
    }

    /** EN: Wires exact Ask and Confirm branches once. ZH: 一次性连接精确的 Ask 与 Confirm 分支。 */
    @Init()
    public init(): void {
        this.switch('type', {
            ask: (signal) => this.wait(signal),
            confirm: (signal) => this.wait(signal),
        });
    }

    /** EN: Resolves an exact pending answer and resumes its Context Turn. ZH: 解析精确匹配的待处理回答，并恢复其 Context Turn。 */
    public answer(turnId: string, id: string, value: unknown): void {
        const pending = this.pending;
        if (!pending || pending.signal.turnId !== turnId || pending.signal.id !== id) {
            throw Error('Interaction response does not match the pending signal');
        }
        const response = this.response(pending.signal, value);
        this.socket.write({ action: 'resume', data: { turnId, id } });
        this.context.resume(turnId, id);
        this.pending = undefined;
        pending.resolve(response);
    }

    /** EN: Replays the exact pending interaction after transport reconnects. ZH: transport 重连后原样重放待处理交互。 */
    public connected(): void {
        if (this.pending) this.publish(this.pending.signal);
    }

    /** EN: Pauses one Turn and waits for its exact user response. ZH: 暂停一个 Turn，并等待其精确用户响应。 */
    private async wait(signal: InteractionSignal): Promise<InteractionResponse> {
        if (this.pending) throw Error('An interaction is already pending');
        this.context.pause(signal.turnId, {
            id: signal.id,
            kind: signal.type,
        });
        const response = new Promise<InteractionResponse>((resolve) => {
            this.pending = { signal, resolve };
        });
        if (this.socket.connected) this.publish(signal);
        return await response;
    }

    /** EN: Publishes one pending interaction and its pause marker in order. ZH: 按序发布一个待处理交互及其 pause 标记。 */
    private publish(signal: InteractionSignal): void {
        this.socket.write({ action: signal.type, data: signal });
        this.socket.write({ action: 'pause', data: { turnId: signal.turnId, id: signal.id, kind: signal.type } });
    }

    /** EN: Reads one response according to its exact pending interaction kind. ZH: 按待处理交互的精确类型读取一次响应。 */
    private response(signal: InteractionSignal, value: unknown): InteractionResponse {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Interaction response must be an object');
        const response = value as Record<string, unknown>;
        if (signal.type === 'confirm') {
            if (response.kind !== 'confirm' || typeof response.approved !== 'boolean') throw Error('Confirm response is invalid');
            return { kind: 'confirm', approved: response.approved } satisfies ConfirmResponse;
        }
        if (response.kind !== 'ask' || !Array.isArray(response.answers)) throw Error('Ask response is invalid');
        const answers = response.answers.map((answer, index) => {
            if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) throw Error(`Ask answer is invalid: ${index}`);
            const item = answer as Record<string, unknown>;
            if (typeof item.question !== 'string' || typeof item.answer !== 'string') throw Error(`Ask answer is invalid: ${index}`);
            return { question: item.question, answer: item.answer };
        });
        return { kind: 'ask', answers } satisfies AskResponse;
    }
}
