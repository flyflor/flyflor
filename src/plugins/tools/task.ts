import type { Agent } from '@/agent';
import type { ConfigService } from '@/configuration';
import { Config, FToolAtom, Tool, useContainer } from '@/core';
import type { Synapse } from '@/neural';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskAgentInput, TaskInput, TaskOutput } from './types';

interface TaskAgent {
    name: string;
    soul: string;
    extension: string;
    prompt: string;
}

@Tool()
/**
 * EN: Task class declaration.
 * ZH: Task class 声明。
 */
export class Task extends FToolAtom<TaskInput, TaskOutput> {
    @Config()
    public config!: ConfigService;

    public override async onPipe(input: TaskInput) {
        const goal = this.text(input.goal, 'goal');
        const agents = this.agents(input.agents);
        const synapse = await this.synapse();
        const created: string[] = [];
        const reused: string[] = [];

        for (const agent of agents) {
            const status = this.ensurePackage(agent);
            if (status === 'created') created.push(agent.name);
            else reused.push(agent.name);
            this.ensureProfile(agent.name);
        }

        const instances = await Promise.all(agents.map((agent) => synapse.spawnAgent(agent.name)));
        instances.forEach((agent, index) => agent.next(agents[index]!.prompt));

        return {
            ok: true,
            data: {
                action: 'task',
                goal,
                created,
                reused,
                dispatched: agents.map((agent) => agent.name),
            },
            effects: created.map((name) => ({ type: 'write' as const, path: this.agentPath(name) })),
        } as const;
    }

    private async synapse(): Promise<Pick<Synapse, 'spawnAgent'>> {
        const { Synapse } = await import('@/neural');
        return await useContainer().getAsync(Synapse);
    }

    private ensurePackage(agent: TaskAgent): 'created' | 'reused' {
        const target = this.agentPath(agent.name);
        if (existsSync(target)) return 'reused';
        const source = this.agentPath(this.config.agent);
        if (!existsSync(source)) throw Error(`agent template missing: ${this.config.agent}`);
        mkdirSync(this.agentsPath(), { recursive: true });
        cpSync(source, target, { recursive: true });
        writeFileSync(join(target, 'SOUL.md'), this.content(agent.soul), 'utf-8');
        writeFileSync(join(target, 'EXTENSION.md'), this.content(agent.extension), 'utf-8');
        return 'created';
    }

    private ensureProfile(name: string): void {
        if (this.config.agents[name]) return;
        const base = this.config.agents[this.config.agent] ?? this.config.agents.flyflor;
        if (!base) throw Error(`agent profile template missing: ${this.config.agent}`);
        this.config.agents[name] = { ...base, name };
    }

    private agents(value: unknown): TaskAgent[] {
        if (!Array.isArray(value) || value.length === 0) throw Error('agents is required');
        return value.map((item, index) => this.agent(item, index));
    }

    private agent(value: unknown, index: number): TaskAgent {
        if (typeof value !== 'object' || value === null) throw Error(`agents[${index}] must be an object`);
        const agent = value as TaskAgentInput;
        const name = this.name(agent.name, index);
        return {
            name,
            soul: this.text(agent.soul, `agents[${index}].soul`),
            extension: this.text(agent.extension, `agents[${index}].extension`),
            prompt: this.text(agent.prompt, `agents[${index}].prompt`),
        };
    }

    private name(value: unknown, index: number): string {
        const name = this.text(value, `agents[${index}].name`).trim();
        if (!/^[A-Za-z0-9_-]+$/.test(name)) throw Error(`agents[${index}].name must use letters, numbers, underscores, or dashes`);
        if (name === this.config.agent) throw Error(`agents[${index}].name cannot be the active agent`);
        return name;
    }

    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.trim().length === 0) throw Error(`${name} is required`);
        return value;
    }

    private content(value: string): string {
        return value.endsWith('\n') ? value : `${value}\n`;
    }

    private agentPath(name: string): string {
        return join(this.agentsPath(), name);
    }

    private agentsPath(): string {
        return join(this.config.path.root, '.config', 'agents');
    }
}
