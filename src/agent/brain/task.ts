import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { Synapse } from '@/neural/synapse';
import { FService, Inject, Prompt, PromptService, Provide, type PromptPackageData } from '@/core';
import { parse } from '@/agent/json';
import { Intelligence } from './intelligence/service';
import type { Summary } from '@/agent/context';

export enum TaskPrompt {
    Plan = 'task',
}

export interface TaskSlice {
    profile: string;
    brief: string;
    slice: string;
}

export interface TaskPlan {
    decompose: boolean;
    plan: TaskSlice[];
    synthesisHint: string;
}

export interface WorkerSummary {
    profile: string;
    slice: string;
    summary: Summary | undefined;
    brief: string;
}

export interface TaskOutcome {
    decomposed: boolean;
    workers: WorkerSummary[];
    synthesisHint: string;
}

/**
 * EN: Task is the multi-agent coordinator inside the active agent's brain.
 * ZH: Task 是主 agent brain 内部的多 agent 协调器。
 *
 * EN: Callosum picks the `task` route when the user intent looks like it has
 * clearly independent slices. `Task` then asks the LLM (via the
 * `prompts/tools/task.md` package) for a real plan. If the LLM says
 * `decompose: false`, the main brain falls back to the single-agent research
 * path. Otherwise, `Task` asks Synapse to spawn one worker per slice, lets
 * each worker run its own investigation loop, and collects the worker
 * summaries into a single `TaskOutcome` the main brain can fold back into the
 * active Context turn.
 * ZH: 当用户意图看起来有清晰的可独立切片时,Callosum 选 `task` 路由。`Task`
 * 再让 LLM(通过 `prompts/tools/task.md` 协议包)产出一份真计划。如果 LLM
 * 说 `decompose: false`,主 brain 退回单 agent research 路径。否则,`Task`
 * 让 Synapse 为每个切片 spawn 一个 worker,让每个 worker 跑自己的
 * investigation 循环,把 worker 摘要汇成 `TaskOutcome`,主 brain 把它折
 * 回当前 Context turn。
 *
 * EN: Workers do not emit to the socket. They produce one summary each and
 * hand it back to the caller. The main Context's turn is the only durable
 * record of the work.
 * ZH: worker 不向 socket 广播。每个 worker 产出一份摘要交回调用方。主
 * Context 的 turn 是这次工作的唯一持久记录。
 */
@Provide()
export class Task extends FService {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public synapse!: Synapse;

    @Prompt('prompts/tools')
    public prompt!: PromptService<TaskPrompt> & PromptPackageData<TaskPrompt>;

    /**
     * EN: Asks the LLM for a multi-agent plan. Returns `decompose: false`
     * when the work does not actually need parallel workers.
     * ZH: 让 LLM 产出多 agent 计划。当工作不需要并行 worker 时返回
     * `decompose: false`。
     */
    public async plan(baseMessages: AgentMemory[], userText: string): Promise<TaskPlan> {
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(TaskPrompt.Plan) },
            { role: AgentChatRole.User, content: `${JSON.stringify(baseMessages)}\n<latest_user_message>${userText}</latest_user_message>` },
        ]);
        return parse<TaskPlan>(raw);
    }

    /**
     * EN: Runs one plan: spawns workers, lets each one run its own
     * investigation loop, returns a flat list of worker summaries plus the
     * synthesis hint.
     * ZH: 跑一份计划:spawn workers,让每个 worker 跑自己的 investigation
     * 循环,返回 worker 摘要列表加合成提示。
     */
    public async run(plan: TaskPlan, userText: string): Promise<TaskOutcome> {
        if (!plan.decompose || plan.plan.length === 0) {
            return { decomposed: false, workers: [], synthesisHint: '' };
        }
        const workers = await Promise.all(plan.plan.map(async (slice) => {
            const agent = await this.synapse.spawnWorker(slice.profile);
            const summary = await agent.delegate(slice.brief);
            return { profile: slice.profile, slice: slice.slice, summary, brief: slice.brief };
        }));
        return { decomposed: true, workers, synthesisHint: plan.synthesisHint };
    }

}