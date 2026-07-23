/**
 * EN: One finished investigation result.
 * `answer` is the synthesized finding; `steps` counts research steps for diagnostics.
 * ZH: 一次完成的研究结果。`answer` 是综合出的发现；`steps` 是用于诊断的研究步数。
 */
export interface InvestigationOutcome {
    /** EN: Synthesized final answer text. ZH: 综合出的最终答案文本。 */
    answer: string;
    /** EN: Number of research steps the loop took. ZH: 循环走过的研究步数。 */
    steps: number;
    /** EN: Whether the loop finished with a final answer. ZH: 循环是否带着最终答案完成。 */
    completed: boolean;
    /** EN: Whether the loop paused on an interaction request. ZH: 循环是否因交互请求而暂停。 */
    paused: boolean;
    /** EN: Compact evidence lines collected from tool results. ZH: 从工具结果收集的紧凑证据行。 */
    evidence: string[];
    /** EN: The loop yielded to a preempting stimulus; evidence holds the salvage. ZH: 循环让位于抢占刺激;evidence 持有 salvage 下来的内容。 */
    interrupted?: boolean;
}

/**
 * EN: Options controlling one investigation run.
 * ZH: 控制单次 investigation 运行的选项。
 */
export interface InvestigationRunOptions {
    /** EN: Whether reply chunks are emitted to the socket; workers pass false. ZH: 是否向 socket 广播回复片段；worker 传 false。 */
    emitReply?: boolean;
    /** EN: Turn this run belongs to, used for preemption and interaction. ZH: 本次运行所属的 turn，用于抢占与交互。 */
    turnId?: string;
    /** EN: Stream identifier forwarded with emitted reply chunks. ZH: 随回复片段一起广播的流标识。 */
    streamId?: string;
    /** EN: Working directory injected into cwd-capable tool calls. ZH: 注入到支持 cwd 的工具调用中的工作目录。 */
    cwd?: string;
    /** EN: Cancellation signal for the whole run. ZH: 整次运行的取消信号。 */
    signal?: AbortSignal;
}
