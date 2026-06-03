import { Agent } from "@/agent";
import { Config, Init, Service } from "./decorators";
import { useContainer } from "./ioc";
import type { FAgentProfileConfiguration, FModelConfiguration } from "@/shard/components";

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

    @Init()
    public async init() {
        // console.log('Runtime ...', this.masterAgent);
        const agent = await this.container.getAsync(Agent, this.master);
        // this.agents.push(agent);
    }
}
