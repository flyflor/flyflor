import { Provide } from '@/core';
import { Tool } from './abstracts';
import type { TaskInput, TaskItemInput, TaskOutput } from './types';

/**
 * EN: Validates pure delegation descriptions without creating or dispatching Agents.
 * ZH: 验证纯委派描述，不创建或派发 Agent。
 */
@Provide()
export class Task extends Tool<TaskInput, TaskOutput> {
    public readonly name = 'task';
    public readonly risk = 'interaction';
    public readonly parameters = {
        type: 'object',
        properties: {
            tasks: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        agent: { type: 'string' },
                        goal: { type: 'string' },
                    },
                    required: ['agent', 'goal'],
                },
            },
        },
        required: ['tasks'],
    } as const;

    /**
     * EN: Returns one strictly validated delegation payload for Synapse.
     * ZH: 为 Synapse 返回一份严格验证的委派 payload。
     */
    public override execute(input: TaskInput) {
        if (!Array.isArray(input.tasks) || input.tasks.length === 0) throw Error('tasks is required');
        const tasks = input.tasks.map((value, index) => {
            if (typeof value !== 'object' || value === null) throw Error(`tasks[${index}] must be an object`);
            const item = value as TaskItemInput;
            if (typeof item.agent !== 'string' || item.agent.length === 0) throw Error(`tasks[${index}].agent is required`);
            if (typeof item.goal !== 'string' || item.goal.length === 0) throw Error(`tasks[${index}].goal is required`);
            return { agent: item.agent, goal: item.goal };
        });
        return { ok: true, data: { tasks }, effects: [{ type: 'task' }] } as const;
    }
}
