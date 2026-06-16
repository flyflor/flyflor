import { Agent } from '@/agent';
import { Memory } from '@/agent/memory';
import { Config, Init, Logger, Singleton, useContainer, type FLogger } from '@/core';
import { ConfigComponent } from '@/config';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { Subject } from 'rxjs';
import { SocketEvent, type SocketPacket, type SocketUserPayload } from './packet';
import type { AgentTurnInput } from '@/agent/memory';

export interface AgentPool {
    active: string;
    agents: { [name: string]: Agent };
}

@Singleton()
export class Synapse<T extends SocketPacket = SocketPacket> extends Subject<T> {
    @Config()
    public readonly config!: ConfigComponent;

    @Logger(Synapse.name)
    public readonly log!: FLogger;

    public agentPool: AgentPool;

    public get agent() {
        return this.agentPool.agents[this.agentPool.active]!;
    }

    constructor() {
        super();
        this.agentPool = { active: '', agents: {} };
    }

    /**
     * Spawns the master agent from the configured `activeAgent` profile and logs the runtime as
     * ready. The master agent's `@Init` runs the constitution-layer soul check before this method
     * returns, so a missing soul file is fatal at boot.
     */
    @Init()
    public async init(): Promise<void> {
        const active = this.config.agent;
        this.agentPool.active = active;
        const agentConfig = this.config.agents[active];
        if (!agentConfig) {
            throw Object.assign(Error('Default agent profile is missing'), {
                detail: { active, configuredAgents: Object.keys(this.config.agents) },
            });
        }
        agentConfig.model = agentConfig.model || this.config.model.model || this.config.model.default;
        agentConfig.provider = agentConfig.provider || this.config.model.provider;
        agentConfig.contextLength = agentConfig.contextLength || this.config.model.contextLength;
        agentConfig.maxTokens = agentConfig.maxTokens || this.config.model.maxTokens;
        // Build the agent's working memory once and pass it down the agent subtree, so Agent and Brain share
        // one Memory per agent (a person's memory), while different agents stay isolated.
        const memory = await useContainer().getAsync(Memory, agentConfig);
        this.agentPool.agents[active] = await useContainer().getAsync(Agent, agentConfig, memory);
    }

    public override async next(packet: SocketPacket): Promise<void> {
        this.log.debug(packet);
        // Broadcast inbound packets for observers, then route user input into the active agent.
        super.next(packet as T);
        this.log.debug('user.payload', packet);
        if (packet.action !== SocketEvent.User) return;
        await this.agent.run(this.turnInput(packet.data));
    }

    private turnInput(data: unknown): AgentTurnInput {
        if (typeof data === 'string') {
            return this.turnInputFromContent(data);
        }
        if (this.isSocketUserPayload(data)) {
            const input = this.turnInputFromContent(data.text);
            if (typeof data.workingDirectory === 'string' && data.workingDirectory.trim().length > 0) input.workingDirectory = data.workingDirectory;
            return input;
        }
        throw Object.assign(Error('Invalid user payload'), { detail: { data } });
    }

    private isSocketUserPayload(data: unknown): data is SocketUserPayload {
        return typeof data === 'object' && data !== null && typeof (data as SocketUserPayload).text === 'string';
    }

    private turnInputFromContent(content: string): AgentTurnInput {
        const parsed = this.parseContentMetadata(content);
        const toolRoots = this.existingAbsoluteRoots(parsed.content);
        return {
            content: parsed.content,
            ...(parsed.workingDirectory !== undefined ? { workingDirectory: parsed.workingDirectory } : {}),
            ...(toolRoots.length > 0 ? { toolRoots } : {}),
        };
    }

    private parseContentMetadata(content: string): { content: string; workingDirectory?: string } {
        const lines = content.split(/\r?\n/);
        const kept: string[] = [];
        let workingDirectory: string | undefined;
        for (const line of lines) {
            const match = line.match(/^\s*(?:执行目录|working\s*directory|cwd)\s*[:：]\s*(.+?)\s*$/i);
            if (match?.[1] !== undefined) {
                const value = this.trimPathToken(match[1].trim());
                if (value.length > 0) workingDirectory = value;
                continue;
            }
            kept.push(line);
        }
        const normalized = kept.join('\n').trim();
        return {
            content: normalized.length > 0 ? normalized : content.trim(),
            ...(workingDirectory !== undefined ? { workingDirectory } : {}),
        };
    }

    private existingAbsoluteRoots(content: string): string[] {
        const roots: string[] = [];
        for (const match of content.matchAll(/\/[^\s"'<>`]+/g)) {
            const candidate = this.trimPathToken(match[0]);
            if (!existsSync(candidate)) continue;
            const real = realpathSync(candidate);
            statSync(real);
            if (!roots.includes(real)) roots.push(real);
        }
        return roots;
    }

    private trimPathToken(value: string): string {
        return value.replace(/[),，。；;：:!?！？]+$/g, '');
    }
}
