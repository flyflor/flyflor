import { FComponent, Init, Provide, useContainer } from '@/core';
import { Cortex } from '@/neural/cortex';
import { SituationModel } from '@/neural/situation';
import { Scheduler, Thalamus, type Stimulus } from '@/neural/thalamus';
import { Workspace } from '@/neural/workspace';
import { AgentProfile } from './types';

/**
 * EN: Agent is one assembled life-form of the population: a private neural
 * stack (situation, workspace, scheduler, thalamus, cortex) built around one
 * profile. Agents share only the global singletons (socket transport,
 * intelligence, tools, config); every layer that holds per-speaker state is
 * constructed fresh inside the agent.
 * ZH: Agent 是种群中一个组装好的生命体:围绕一份 profile 构建的私有神经栈
 * (situation、workspace、scheduler、thalamus、cortex)。agent 之间只共享全局
 * 单例(socket 传输、intelligence、tools、config);所有持有说话人状态的层
 * 都在 agent 内部全新构造。
 */
@Provide()
export class Agent extends FComponent {
    /** EN: In-process situation buffer private to this agent. ZH: 该 agent 私有的进程内情境缓冲。 */
    public situation!: SituationModel;
    /** EN: Bounded semantic working set private to this agent. ZH: 该 agent 私有的有界语义工作集。 */
    public workspace!: Workspace;
    /** EN: Central executive private to this agent. ZH: 该 agent 私有的中央执行器。 */
    public scheduler!: Scheduler;
    /** EN: Attention gate private to this agent. ZH: 该 agent 私有的注意门。 */
    public thalamus!: Thalamus;
    /** EN: Neural cortex private to this agent. ZH: 该 agent 私有的神经皮层。 */
    public cortex!: Cortex;

    constructor(
        /** EN: Population profile this agent is assembled around. ZH: 该 agent 组装所围绕的种群档案。 */
        public readonly profile: AgentProfile,
    ) {
        super();
    }

    /**
     * EN: Builds the private neural stack bottom-up, threading each layer into
     * the next through constructor props so no per-agent state is shared.
     * ZH: 自底向上构建私有神经栈,逐层通过构造参数穿线,保证 agent 间不共享
     * 任何私有状态层。
     */
    @Init()
    public async init() {
        this.situation = await useContainer().getAsync(SituationModel);
        this.workspace = await useContainer().getAsync(Workspace, this.situation);
        this.scheduler = await useContainer().getAsync(Scheduler, this.workspace);
        this.thalamus = await useContainer().getAsync(Thalamus, this.workspace, this.scheduler);
        this.cortex = await useContainer().getAsync(Cortex, this.workspace, this.thalamus, this.profile);
        return true;
    }

    /** EN: The profile id of this agent. ZH: 该 agent 的档案 id。 */
    public get id(): string {
        return this.profile.id;
    }

    /**
     * EN: Forwards one inbound user message into this agent's attention gate.
     * ZH: 把一条入站用户消息转发进该 agent 的注意门。
     */
    public perceive(input: { speakerId: string; text: string }): Stimulus | undefined {
        return this.thalamus.perceive(input);
    }

    /**
     * EN: Forwards one interaction answer into this agent's attention gate.
     * ZH: 把一条交互答复转发进该 agent 的注意门。
     */
    public answer(turnId: string, id: string, response: unknown, speakerId?: string): void {
        this.thalamus.answer(turnId, id, response, speakerId);
    }

    /**
     * EN: Releases every piece of state the agent holds for one speaker.
     * ZH: 释放该 agent 为某个说话人持有的全部状态。
     */
    public forget(speakerId: string): void {
        this.thalamus.forget(speakerId);
    }
}
