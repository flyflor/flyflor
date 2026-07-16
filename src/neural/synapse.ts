import {
    type AgentBus,
    type NeuralResponse,
    type NeuralSignal,
} from '@/agent';
import type { Agent } from '@/agent';
import type { ConfigService } from '@/config';
import { FCortex, Init, Inject, Module } from '@/core';
import { FSocket } from '@/transport';
import { Delegation } from './delegation';
import { Expression } from './expression';
import { Interaction } from './interaction';
import { AgentPool } from './pool';
import { Sensory } from './sensory';

/**
 * ZH: 组合独立信号回路与唯一持久 Agent pool 的 singleton 皮层门面。
 * EN: Singleton cortical facade composing independent signal circuits and one persistent Agent pool.
 */
@Module()
export class Synapse extends FCortex implements AgentBus {
    @Inject()
    private pool!: AgentPool;

    @Inject()
    private sensory!: Sensory;

    @Inject()
    private interaction!: Interaction;

    @Inject()
    private delegation!: Delegation;

    @Inject()
    private expression!: Expression;

    @Inject()
    private socket!: FSocket;

    /** ZH: 一次性绑定皮层对象图与 transport callbacks。 EN: Binds the cortical object graph and transport callbacks exactly once. */
    @Init()
    public async init(): Promise<void> {
        await this.pool.bind(this);
        this.sensory.bind(this.pool);
        this.delegation.bind(this.pool);
        await this.socket.bind({
            connected: () => this.interaction.connected(),
            input: async (text) => { await this.sensory.next(text); },
            answer: (turnId, id, response) => this.answer(turnId, id, response),
        });
    }

    /** ZH: 暴露 profile 保持副本而 cwd 可变的 runtime 配置。 EN: Exposes runtime configuration whose profiles are copied while cwd may change. */
    public get config(): ConfigService {
        return this.pool.config;
    }

    /** ZH: 返回当前活跃的持久人物。 EN: Returns the currently active persistent person. */
    public get agent(): Agent {
        return this.pool.agent;
    }

    /** ZH: 将一次 Agent 放电路由到唯一的独立皮层回路。 EN: Routes one Agent firing to exactly one independent cortical circuit. */
    public async fire<TSignal extends NeuralSignal>(signal: TSignal): Promise<NeuralResponse<TSignal>> {
        if (signal.type === 'ask' || signal.type === 'confirm') {
            return await this.interaction.next(signal) as NeuralResponse<TSignal>;
        }
        if (signal.type === 'task') {
            return await this.delegation.next(signal) as NeuralResponse<TSignal>;
        }
        await this.expression.next(signal);
        return undefined as NeuralResponse<TSignal>;
    }

    /** ZH: 返回已有的人物，或一次性创建其隔离 IOC scope。 EN: Returns an existing person or creates its isolated IOC scope once. */
    public async spawnAgent(name: string): Promise<Agent> {
        return await this.pool.spawn(name);
    }

    /** ZH: 通过交互回路解析一个精确匹配的待处理用户回答。 EN: Resolves an exact pending user answer through the interaction circuit. */
    public answer(turnId: string, id: string, value: unknown): void {
        this.interaction.answer(turnId, id, value);
    }
}
