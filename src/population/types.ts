/**
 * EN: Immutable description of one agent in the population. It is a data
 * class (not an interface) so constructor-parameter reflection keeps the
 * runtime class and `@Scope()` matching can find it by `instanceof`.
 * ZH: 种群中单个 agent 的不可变描述。它是数据 class(不是 interface),
 * 使构造参数反射保留运行时 class,`@Scope()` 可以按 `instanceof` 命中。
 */
export class AgentProfile {
    constructor(
        /** EN: Unique agent id inside the population. ZH: agent 在种群内的唯一 id。 */
        public readonly id: string,
        /** EN: Optional persona prompt-package path overriding the configured default. ZH: 可选的人格提示词包路径,覆盖配置默认值。 */
        public readonly personaPackage?: string,
    ) {}
}

/**
 * EN: Routing boundary between the shared transport and the agent population.
 * The socket surface owns connections; the router decides which agent
 * perceives, answers, and forgets for each speaker.
 * ZH: 共享传输与 agent 种群之间的路由边界。socket 面持有连接;路由器决定每个
 * 说话人的感知、答复与遗忘交给哪个 agent。
 */
export interface PopulationRouter {
    /** EN: Routes one inbound user message to the speaker's bound agent. ZH: 把一条入站用户消息路由到说话人绑定的 agent。 */
    perceive(input: { speakerId: string; text: string }): unknown;
    /** EN: Routes one interaction answer to the speaker's bound agent. ZH: 把一条交互答复路由到说话人绑定的 agent。 */
    answer(turnId: string, id: string, response: unknown, speakerId?: string): void;
    /** EN: Drops the speaker's binding and releases its per-agent state. ZH: 丢弃说话人的绑定并释放其在 agent 侧的状态。 */
    forget(speakerId: string): void;
    /** EN: Rebinds one speaker to another agent; false when the agent id is unknown. ZH: 把说话人换绑到另一个 agent;agent id 未知时返回 false。 */
    route(speakerId: string, agentId: string): boolean;
}
