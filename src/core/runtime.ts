import { Agent } from "@/agent";
import { Config, Init, Service } from "./decorators";
import { useContainer } from "./ioc";
import type { FAgentProfileConfiguration, FModelConfiguration } from "@/shard/components";

/**
 * Runtime owns the active agent worker set for the current Flyflor process.
 * It resolves the configured master agent during initialization and exposes the narrow chat entry used by IPC.
 */
@Service()
export class Runtime {

    @Config('agent')
    public readonly agent!: string;

    @Config('agents')
    public readonly agents!: Record<string, FAgentProfileConfiguration>;

    @Config('model')
    public readonly llm!: FModelConfiguration;

    public get master() {
        const agent = this.agents[this.agent] as FAgentProfileConfiguration;
        agent.model = agent.model || this.llm.model || this.llm.default;
        agent.provider = agent.provider || this.llm.provider;
        return agent;
    }

    public get container() {
        return useContainer();
    }

    public agentWorkers: Agent[];

    constructor() {
        this.agentWorkers = [];
    }

    /**
     * Initializes the configured master agent and stores it as the first runtime worker.
     */
    @Init()
    public async init() {
        const agent = await this.container.getAsync(Agent, this.master);
        this.agentWorkers.push(agent);
    }

    /**
     * Sends one user turn to the active master agent.
     * @param content - Raw user text received from an external transport.
     * @returns The model-backed agent reply.
     */
    public async chat(content: string): Promise<string> {
        const agent = this.agentWorkers[0];
        if (agent === undefined) {
            throw Object.assign(Error('Runtime master agent is not initialized'), {
                detail: { workerCount: this.agentWorkers.length },
            });
        }
        return agent.chat(content);
    }
}
