import type { SandboxConfig } from "../../config/index.ts";
import { SandboxMode } from "../../shared/core/enums.ts";

export interface SandboxPolicy {
    mode: SandboxMode;
    canExecuteTools: boolean;
    requiresApproval: boolean;
    summary: string;
}

export function createSandboxPolicy(config: SandboxConfig): SandboxPolicy {
    if (config.mode === SandboxMode.Yolo) {
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
