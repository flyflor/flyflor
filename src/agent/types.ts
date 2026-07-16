import type { ContextBrief } from '@/agent/context';
import type { ToolCall } from '@/model';

/** ZH: 分配给持久 Agent 的一项皮层任务。 EN: One cortical task assigned to a persistent Agent. */
export interface AgentTask {
    id: string;
    agent: string;
    goal: string;
    context: ContextBrief;
}

/** ZH: 一个 Agent 私有 FIFO 接受的刺激。 EN: Stimuli accepted by one Agent's private FIFO. */
export type AgentStimulus =
    | { type: 'input'; input: string }
    | { type: 'task'; task: AgentTask };

/** ZH: 一项请求的子调查。 EN: One requested child investigation. */
export interface TaskItem {
    agent: string;
    goal: string;
}

/** ZH: 一个 Agent 返回的纯最终认知。 EN: Pure final cognition returned by one Agent. */
export interface CompleteSignal {
    type: 'complete';
    id: string;
    turnId: string;
    agent: string;
    answer: string;
    evidence: string[];
}

/** ZH: Investigation 发出的用户澄清放电。 EN: User clarification firing emitted by Investigation. */
export interface AskSignal {
    type: 'ask';
    turnId: string;
    id: string;
    agent: string;
    questions: Array<{ question: string; options: Array<{ label: string; description?: string; recommended?: boolean; custom?: boolean }> }>;
}

/** ZH: 危险动作前发出的工具审批放电。 EN: Tool approval firing emitted before a risky action. */
export interface ConfirmSignal {
    type: 'confirm';
    turnId: string;
    id: string;
    agent: string;
    call: ToolCall;
}

/** ZH: Investigation 发出的多 Agent 委派放电。 EN: Multi-Agent delegation firing emitted by Investigation. */
export interface TaskSignal {
    type: 'task';
    turnId: string;
    id: string;
    agent: string;
    tasks: TaskItem[];
}

/** ZH: 根 Agent 发出的用户可见表达。 EN: User-visible expression emitted by one root Agent. */
export interface ReplySignal {
    type: 'reply';
    turnId: string;
    agent: string;
    chunk: string;
}

/** ZH: Synapse 神经回路接受的信号。 EN: Signals accepted by Synapse neural circuits. */
export type NeuralSignal = AskSignal | ConfirmSignal | TaskSignal | ReplySignal | CompleteSignal;

/** ZH: 对一次 Ask 放电的结构化回答。 EN: Structured answer to one Ask firing. */
export interface AskResponse {
    kind: 'ask';
    answers: Array<{ question: string; answer: string }>;
}

/** ZH: 对一次 Confirm 放电的结构化决定。 EN: Structured decision for one Confirm firing. */
export interface ConfirmResponse {
    kind: 'confirm';
    approved: boolean;
}

/** ZH: 与一个神经信号关联的响应类型。 EN: Response type correlated with one neural signal. */
export type NeuralResponse<TSignal extends NeuralSignal> =
    TSignal extends AskSignal ? AskResponse
        : TSignal extends ConfirmSignal ? ConfirmResponse
            : TSignal extends TaskSignal ? CompleteSignal[]
                : void;

/**
 * ZH: 一个 Agent scope 内可用的狭窄皮层放电边界。
 * EN: Narrow cortical firing boundary available inside one Agent scope.
 */
export interface AgentBus {
    fire<TSignal extends NeuralSignal>(signal: TSignal): Promise<NeuralResponse<TSignal>>;
}
