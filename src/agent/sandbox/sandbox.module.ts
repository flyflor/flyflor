import type { SandboxConfig } from "../../config/index.ts";
import { ArchitectureLayer, ComponentKind, SandboxMode } from "../../protocol/contracts/index.ts";
import { Sandbox } from "../components.ts";
import { Module, Provide } from "../di/decorators/index.ts";

export interface SandboxPolicy {
    mode: SandboxMode;
    canExecuteTools: boolean;
    requiresApproval: boolean;
    summary: string;
}

@Module({ name: "sandbox", tags: ["flyflor", "boundary"] })
@Provide({ kind: ComponentKind.Sandbox, layer: ArchitectureLayer.Control, name: "sandbox", provider: true })
export class SandboxModule extends Sandbox {
    constructor(private readonly config: SandboxConfig) {
        super();
    }

    policy(): SandboxPolicy {
        if (this.config.mode === SandboxMode.Yolo) {
            return {
                mode: SandboxMode.Yolo,
                canExecuteTools: true,
                requiresApproval: false,
                summary: "YOLO mode: tool execution is allowed without interactive approval.",
            };
        }

        return {
            mode: SandboxMode.Off,
            canExecuteTools: false,
            requiresApproval: true,
            summary: "Sandbox is off and tool execution is disabled in this initial gateway build.",
        };
    }
}

export function createSandboxPolicy(config: SandboxConfig): SandboxPolicy {
    return new SandboxModule(config).policy();
}
