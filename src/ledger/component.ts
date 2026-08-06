import type { AgentInteractionRequest, AgentInteractionResponse, AgentReport, AgentRuntimeEvent } from '@/agent/types';
import type { Focus, Stimulus } from '@/collective/context/types';
import type { ConfigService } from '@/configuration';
import { Config, FComponent, Init, Inject, Singleton } from '@/core';
import { LedgerRepository } from './repository';
import type { LedgerEventKind } from './types';

/**
 * EN: The life ledger: the permanent, verbatim, append-only record of every conversation.
 * It deliberately ignores the volatile in-memory history; what lands here is never compressed,
 * folded, or evicted. Record calls never break the conversation flow: runtime write failures are
 * logged and swallowed, while boot-time open failures throw so the process never runs unrecorded.
 * ZH: 生命账本：所有对话的永久、逐字、只增记录。它刻意区别于易失的进程内历史——落账的内容
 * 永远不会被压缩、折叠或淘汰。记录调用绝不打断对话流程：运行时写入失败只记日志并吞掉，
 * 而启动期打开失败会抛出，进程绝不静默裸奔。
 */
@Singleton()
export class Ledger extends FComponent {
    @Config()
    public config!: ConfigService;

    @Inject()
    public repository!: LedgerRepository;

    /**
     * EN: Opens the ledger at boot so misconfiguration fails fast.
     * ZH: 启动时即打开账本，配置错误立即失败。
     */
    @Init()
    public init(): void {
        if (!this.config.ledger.enabled) return;
        this.repository.open(this.config.ledger.directory);
    }

    /**
     * EN: Records one accepted inbound user message verbatim, including ones that only reach the queue.
     * ZH: 逐字记录一条已被接受的用户输入，包括只进到等待队列的。
     */
    public recordStimulus(stimulus: Stimulus): void {
        this.record('stimulus', stimulus.receivedAt, { messageId: stimulus.messageId, speakerId: stimulus.speakerId }, stimulus);
    }

    /**
     * EN: Records one completed dialogue turn verbatim, before volatile history may compress it.
     * ZH: 逐字记录一个已完成的对话轮次，先于易失历史可能做的压缩。
     */
    public recordTurn(focus: Focus, report: AgentReport): void {
        this.record('turn', Date.now(), { focusId: focus.id, speakerId: focus.ownerSpeakerId }, { focus, report });
    }

    /**
     * EN: Records one ask/confirm interaction together with the user's response.
     * ZH: 记录一次 ask/confirm 交互及用户的应答。
     */
    public recordInteraction(request: AgentInteractionRequest, response: AgentInteractionResponse, speakerId: string, messageId?: string): void {
        this.record('interaction', Date.now(), { focusId: request.focusId, messageId, speakerId }, { request, response });
    }

    /**
     * EN: Records one focus cancellation.
     * ZH: 记录一次焦点取消。
     */
    public recordCancellation(focusId: string, revision: number, speakerId: string): void {
        this.record('cancellation', Date.now(), { focusId, speakerId }, { focusId, revision, speakerId });
    }

    /**
     * EN: Records one agent runtime event (tool action start/result).
     * ZH: 记录一条 agent 运行时事件（工具动作开始/结果）。
     */
    public recordAgentEvent(event: AgentRuntimeEvent): void {
        this.record('agent_event', Date.now(), { focusId: event.focusId }, event);
    }

    /**
     * EN: Builds the event envelope, serializes the payload eagerly, and appends it to the ledger.
     * ZH: 构建事件封套、立即序列化 payload，并追加进账本。
     */
    private record(
        kind: LedgerEventKind,
        createdAt: number,
        ids: { focusId?: string; messageId?: string; speakerId?: string },
        payload: unknown,
    ): void {
        if (!this.config.ledger.enabled) return;
        try {
            this.repository.insert({
                id: crypto.randomUUID(),
                kind,
                createdAt,
                focusId: ids.focusId,
                messageId: ids.messageId,
                speakerId: ids.speakerId,
                payload: JSON.stringify(payload),
            });
        } catch (error) {
            this.log.error('ledger.record.failed', { kind, error: error instanceof Error ? error.message : String(error) });
        }
    }
}
