import { AgentChatRole } from '@/agent/types';
import { FAgentAtom, Prompt, PromptService, Provide, Scope } from '@/core';
import { parse } from '@/agent/json';
import { Intelligence } from './intelligence/service';

/** EN: Prompt sections owned by the callosum package. ZH: callosum 提示词包拥有的 section。 */
export enum CallosumPrompt {
    /** EN: Route classification section. ZH: 路由分类 section。 */
    Route = 'ROUTE',
}

/** EN: Signal kinds exchanged between brain, cortex, and the socket boundary. ZH: brain、皮层与 socket 边界之间交换的信号类别。 */
export enum CallosumSignalType {
    /** EN: Long-term note write signal. ZH: 长期笔记写入信号。 @deprecated Long-term note writes are disabled; retained for wire compatibility. */
    Soul = 'soul',
    /** EN: Visible reply chunk signal. ZH: 可见回复片段信号。 */
    Reply = 'reply',
    /** EN: Tool-using research route signal. ZH: 使用工具的研究路由信号。 */
    Research = 'research',
    /** EN: Legacy task route signal. ZH: 旧版任务路由信号。 @deprecated Use Coordinate instead. Kept for prompt compatibility. */
    Task = 'task',
    /** EN: Multi-agent coordination route signal. ZH: 多 agent 协同路由信号。 */
    Coordinate = 'coordinate',
    /** EN: Research summary signal. ZH: 研究摘要信号。 */
    ResearchSummary = 'research_summary',
    /** EN: Clarification request signal. ZH: 澄清请求信号。 */
    Clarification = 'clarification',
    /** EN: Turn pause signal. ZH: turn 暂停信号。 */
    Pause = 'pause',
    /** EN: Turn resume signal. ZH: turn 恢复信号。 */
    Resume = 'resume',
    /** EN: Tool action start signal. ZH: 工具 action 开始信号。 */
    ActionStart = 'action_start',
    /** EN: Tool action result signal. ZH: 工具 action 结果信号。 */
    ActionResult = 'action_result',
    /** EN: Provider request step signal. ZH: provider 请求步进信号。 */
    LlmRequest = 'llm_request',
    /** EN: Terminal done signal. ZH: 终止完成信号。 */
    Done = 'done',
}

/**
 * EN: One routed signal carrying the classified type and the originating text chunk.
 * ZH: 一条承载分类类型与原始文本片段的路由信号。
 */
export interface CallosumSignal {
    /** EN: Classified signal type. ZH: 分类后的信号类型。 */
    type: CallosumSignalType;
    /** EN: Originating text chunk, or the terminal Done marker. ZH: 原始文本片段，或终止 Done 标记。 */
    chunk: CallosumSignalType.Done | string;
    /** EN: Optional structured payload attached to the signal. ZH: 挂在信号上的可选结构化负载。 */
    data?: unknown;
}

/**
 * EN: Callosum is the legacy routing boundary that classifies one user message
 * into a reply / research / coordinate route. The active path reads Context.intent
 * directly; this class remains for callers that still use the route API.
 * ZH: Callosum 是旧版路由边界，负责把一条用户消息分类为 reply / research /
 * coordinate 路由。活跃路径直接读取 Context.intent；该类为仍使用 route API
 * 的调用方保留。
 */
@Provide()
export class Callosum extends FAgentAtom<string, CallosumSignal> {
    @Prompt('prompts/callosum')
    /** EN: Prompt package holding the ROUTE classification section. ZH: 持有 ROUTE 分类 section 的提示词包。 */
    public prompt!: PromptService<CallosumPrompt>;

    @Scope()
    /** EN: Provider-facing intelligence service scoped to this agent. ZH: 该 agent 作用域内面向 provider 的智能服务。 */
    public intelligence!: Intelligence;

    /**
     * EN: Classifies one user message into a reply / research / coordinate route.
     * ZH: 把一条用户消息分类为 reply / research / coordinate 路由。
     *
     * EN: `coordinate` is returned when the user intent requires multiple agents to jointly
     * summarize and understand it. The cortex (Synapse) then dispatches the agent pool.
     * ZH: 当用户意图需要多个 agent 协同摘要理解时返回 `coordinate`，由皮层 Synapse 派发 agent pool。
     *
     * EN: Throws on malformed route output; the single turn boundary in `Brain` owns recovery.
     * ZH: 路由输出非法时直接抛出；恢复由 `Brain` 的单一回合边界统一处理。
     */
    public async route(data: string): Promise<CallosumSignal> {
        this.log.debug('callosum.start', { textLength: data.length });
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(CallosumPrompt.Route) },
            { role: AgentChatRole.User, content: `<latest_user_message>${data}</latest_user_message>` },
        ]);
        const type = parse<{ type?: CallosumSignalType }>(raw).type;
        if (
            type === CallosumSignalType.Reply
            || type === CallosumSignalType.Coordinate
        ) {
            return { type, chunk: data };
        }
        if (type === CallosumSignalType.Task) return { type: CallosumSignalType.Coordinate, chunk: data };
        return { type: CallosumSignalType.Research, chunk: data };
    }
}
