import type { FAgentProfileConfiguration } from '@/config';
import { FAgent, Init, Inject, Observable, Provide, Scope } from '@/core';
import type { AgentBus, AgentStimulus, CompleteSignal } from './types';
import { Brain } from './brain';

/**
 * EN: One persistent person with an isolated FIFO and IOC-scoped cognition.
 * ZH: 一个拥有隔离 FIFO 与 IOC scoped cognition 的持久人物。
 *
 * EN: This circuit is the person-boundary FIFO: the same person thinks serially.
 * ZH: 本回路是人物边界 FIFO：同一人物串行思考。
 */
@Provide()
export class Agent extends FAgent<AgentStimulus, CompleteSignal, FAgentProfileConfiguration, AgentBus> {
    @Scope()
    public brain!: Brain;

    /**
     * EN: Person-boundary FIFO from stimulus to pure Complete.
     * ZH: 从刺激到纯 Complete 的人物边界 FIFO。
     */
    @Inject()
    public circuit!: Observable<AgentStimulus, CompleteSignal>;

    /**
     * EN: Wires this person's private signal queue to its Brain once.
     * ZH: 将当前人物的私有信号队列一次性连接到其 Brain。
     */
    @Init()
    public init(): void {
        this.circuit.pipe((stimulus) => this.brain.receive(stimulus));
    }

    /**
     * EN: Queues one input or cortical task for this Agent.
     * ZH: 为当前 Agent 排队一个输入或皮层任务。
     */
    public override async receive(stimulus: AgentStimulus): Promise<CompleteSignal> {
        this.log.info('agent.receive', { agent: this.agentConfig.name, type: stimulus.type });
        return await this.circuit.next(stimulus);
    }
}
