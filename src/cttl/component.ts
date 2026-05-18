import { CapabilityComponent } from "../components/index.ts";
import type {
    CttlRegisteredTool,
    CttlToolDescriptor,
    CttlToolExecutor,
    CttlToolPlan,
    CttlTrustContext,
    CttlTrustPolicyInput,
} from "./types.ts";
import { CttlLoopGuard } from "./loop.guard.ts";
import { CttlToolPlanner } from "./planner.ts";
import { CttlToolRegistry } from "./registry.ts";
import { CttlTrustPolicy } from "./trust.policy.ts";

export class CttlComponent extends CapabilityComponent {
    private readonly registry: CttlToolRegistry;
    private readonly planner: CttlToolPlanner;
    private readonly trustPolicy: CttlTrustPolicy;

    public constructor(
        registry = new CttlToolRegistry(),
        planner = new CttlToolPlanner(),
        trustPolicy = new CttlTrustPolicy(),
    ) {
        super();
        this.registry = registry;
        this.planner = planner;
        this.trustPolicy = trustPolicy;
    }

    public registerTool(descriptor: CttlToolDescriptor, execute?: CttlToolExecutor): void {
        this.registry.register(descriptor, execute);
    }

    public listTools(): CttlRegisteredTool[] {
        return this.registry.list();
    }

    public buildToolPlan(trust: CttlTrustContext = {}): CttlToolPlan {
        return this.planner.build(this.registry.list(), trust);
    }

    public buildTrustContext(input: CttlTrustPolicyInput): CttlTrustContext {
        return this.trustPolicy.build(input);
    }

    public createLoopGuard(options?: ConstructorParameters<typeof CttlLoopGuard>[0]): CttlLoopGuard {
        return new CttlLoopGuard(options);
    }
}
