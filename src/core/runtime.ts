import { AgentComponent } from "@/agent";
import { Init, Service } from "./decorators";
import { useContainer } from "./ioc";

@Service()
export class Runtime {

    public agents: AgentComponent[];

    public get container() {
        return useContainer();
    }

    constructor() {
        this.agents = [];
    }

    @Init()
    public async init() {
        console.log('Runtime ...');
        const agent = await this.container.getAsync(AgentComponent);
        this.agents.push(agent);
    }
}