import type { ContextBrief } from '@/agent/context';
import type { ToolCall } from '@/model';

/** EN: One cortical task assigned to a persistent Agent. ZH: 分配给持久 Agent 的一项皮层任务。 */
export interface AgentTask {
    id: string;
    agent: string;
    goal: string;
    context: ContextBrief;
}

/** EN: Stimuli accepted by one Agent's private FIFO. ZH: 一个 Agent 私有 FIFO 接受的刺激。 */
export type AgentStimulus =
    | { type: 'input'; input: string }
    | { type: 'task'; task: AgentTask };

/** EN: One requested child investigation. ZH: 一项请求的子调查。 */
export interface TaskItem {
    agent: string;
    goal: string;
}

/** EN: Pure final cognition returned by one Agent. ZH: 一个 Agent 返回的纯最终认知。 */
export interface CompleteSignal {
    type: 'complete';
    id: string;
    turnId: string;
    agent: string;
    answer: string;
    evidence: string[];
}

/** EN: User clarification firing emitted by Investigation. ZH: Investigation 发出的用户澄清放电。 */
export interface AskSignal {
    type: 'ask';
    turnId: string;
    id: string;
    agent: string;
    questions: Array<{ question: string; options: Array<{ label: string; description?: string; recommended?: boolean; custom?: boolean }> }>;
}

/** EN: Tool approval firing emitted before a risky action. ZH: 危险动作前发出的工具审批放电。 */
export interface ConfirmSignal {
    type: 'confirm';
    turnId: string;
    id: string;
    agent: string;
    call: ToolCall;
}

/** EN: Multi-Agent delegation firing emitted by Investigation. ZH: Investigation 发出的多 Agent 委派放电。 */
export interface TaskSignal {
    type: 'task';
    turnId: string;
    id: string;
    agent: string;
    tasks: TaskItem[];
}

/** EN: User-visible expression emitted by one root Agent. ZH: 根 Agent 发出的用户可见表达。 */
export interface ReplySignal {
    type: 'reply';
    turnId: string;
    agent: string;
    chunk: string;
}

/** EN: Signals accepted by Synapse neural circuits. ZH: Synapse 神经回路接受的信号。 */
export type NeuralSignal = AskSignal | ConfirmSignal | TaskSignal | ReplySignal | CompleteSignal;

/** EN: Structured answer to one Ask firing. ZH: 对一次 Ask 放电的结构化回答。 */
export interface AskResponse {
    kind: 'ask';
    answers: Array<{ question: string; answer: string }>;
}

/** EN: Structured decision for one Confirm firing. ZH: 对一次 Confirm 放电的结构化决定。 */
export interface ConfirmResponse {
    kind: 'confirm';
    approved: boolean;
}

/** EN: Response type correlated with one neural signal. ZH: 与一个神经信号关联的响应类型。 */
export type NeuralResponse<TSignal extends NeuralSignal> =
    TSignal extends AskSignal ? AskResponse
        : TSignal extends ConfirmSignal ? ConfirmResponse
            : TSignal extends TaskSignal ? CompleteSignal[]
                : void;

/**
 * EN: Narrow cortical firing boundary available inside one Agent scope.
 * ZH: 一个 Agent scope 内可用的狭窄皮层放电边界。
 */
export interface AgentBus {
    fire<TSignal extends NeuralSignal>(signal: TSignal): Promise<NeuralResponse<TSignal>>;
}
