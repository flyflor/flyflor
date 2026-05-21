import { CapabilityComponent } from "../components/index.ts";
import type {
    RegisteredTool,
    ToolDescriptor,
    ToolExecutor,
    ToolPlan,
    TrustContext,
    TrustPolicyInput,
} from "./types.ts";
import { ExecutiveLoopGuard } from "./loop.guard.ts";
import { ToolPlanner } from "./planner.ts";
import { ToolRegistry } from "./registry.ts";
import { TrustPolicy } from "./trust.policy.ts";

export class ExecutiveComponent extends CapabilityComponent {
    private readonly registry: ToolRegistry;
    private readonly planner: ToolPlanner;
    private readonly trustPolicy: TrustPolicy;

    public constructor(
        registry = new ToolRegistry(),
        planner = new ToolPlanner(),
        trustPolicy = new TrustPolicy(),
    ) {
        super();
        this.registry = registry;
        this.planner = planner;
        this.trustPolicy = trustPolicy;
    }

    public registerTool(descriptor: ToolDescriptor, execute?: ToolExecutor): void {
        this.registry.register(descriptor, execute);
    }

    public listTools(): RegisteredTool[] {
        return this.registry.list();
    }

    public buildToolPlan(trust: TrustContext = {}): ToolPlan {
        return this.planner.build(this.registry.list(), trust);
    }

    public buildTrustContext(input: TrustPolicyInput): TrustContext {
        return this.trustPolicy.build(input);
    }

    public createLoopGuard(options?: ConstructorParameters<typeof ExecutiveLoopGuard>[0]): ExecutiveLoopGuard {
        return new ExecutiveLoopGuard(options);
    }
}
