import type { SandboxConfig } from "../../config/index.ts";
import { SandboxMode } from "../../fpc/contracts/index.ts";
import { Sandbox } from "../../fpc/decorators/index.ts";

export interface SandboxPolicy {
    mode: SandboxMode;
    canExecuteTools: boolean;
    requiresApproval: boolean;
    summary: string;
}

@Sandbox()
export class SandboxController {
    constructor(private readonly config: SandboxConfig) {}

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
    return new SandboxController(config).policy();
}
