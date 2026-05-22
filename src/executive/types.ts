import type {
    CapabilitySource,
    CapabilityExecutionKind,
    ToolHiddenReason,
    ExecutiveLoopGuardReason,
    ToolPermission,
    ToolCategory,
    ToolScope,
    TrustSurface,
} from "../protocol/contracts/index.ts";

export type ExecutiveJsonPrimitive = string | number | boolean | null;
export type ExecutiveJsonValue =
    | ExecutiveJsonPrimitive
    | readonly ExecutiveJsonValue[]
    | { readonly [key: string]: ExecutiveJsonValue };
export type ExecutiveJsonObject = { readonly [key: string]: ExecutiveJsonValue };

export interface ToolResultLimit {
    maxChars: number;
}

export const ComputerControlAction = {
    Browser: "browser",
    Keyboard: "keyboard",
    Mouse: "mouse",
    Screen: "screen",
    Window: "window",
} as const;

export type ComputerControlAction =
    (typeof ComputerControlAction)[keyof typeof ComputerControlAction];

export interface ComputerControlProfile {
    readonly action: ComputerControlAction;
    readonly observationOnly: boolean;
    readonly requiresFocusTarget?: boolean;
}

export interface ToolDescriptor {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: ExecutiveJsonObject;
    readonly outputSchema?: ExecutiveJsonObject;
    readonly source: CapabilitySource;
    readonly scope: readonly ToolScope[];
    readonly permission: ToolPermission;
    readonly category: ToolCategory;
    readonly readOnly: boolean;
    readonly concurrencySafe: boolean;
    readonly exclusive: boolean;
    readonly resultLimit: ToolResultLimit;
    readonly computer?: ComputerControlProfile;
    readonly sourceId?: string;
    readonly tags?: readonly string[];
}

export interface RegisteredTool {
    readonly descriptor: ToolDescriptor;
    readonly execute?: ToolExecutor;
}

export interface ToolExecutorInput {
    readonly input: ExecutiveJsonObject;
    readonly requestId?: string;
}

export interface ToolExecutorResult {
    readonly ok: boolean;
    readonly output?: ExecutiveJsonValue;
    readonly error?: string;
}

export type ToolExecutor = (input: ToolExecutorInput) => Promise<ToolExecutorResult> | ToolExecutorResult;

export interface TrustContext {
    readonly allowedSources?: ReadonlySet<CapabilitySource>;
    readonly allowedScopes?: ReadonlySet<ToolScope>;
    readonly maxPermission?: ToolPermission;
    readonly deniedTools?: ReadonlySet<string>;
    readonly unavailableTools?: ReadonlySet<string>;
}

export interface TrustPolicyInput {
    readonly surface: TrustSurface;
    readonly projectScoped?: boolean;
    readonly debug?: boolean;
    readonly allowedSources?: readonly CapabilitySource[];
    readonly maxPermission?: ToolPermission;
    readonly deniedTools?: readonly string[];
    readonly unavailableTools?: readonly string[];
}

export interface ToolPlanEntry {
    readonly descriptor: ToolDescriptor;
}

export interface HiddenToolPlanEntry {
    readonly descriptor: ToolDescriptor;
    readonly diagnostics: readonly ToolPlanDiagnostic[];
}

export interface ToolPlanDiagnostic {
    readonly reason: ToolHiddenReason;
    readonly message: string;
}

export interface ToolPlan {
    readonly visible: readonly ToolPlanEntry[];
    readonly hidden: readonly HiddenToolPlanEntry[];
}

export interface CapabilitySummary {
    readonly category: ToolCategory;
    readonly computer?: ComputerControlProfile;
    readonly concurrencySafe: boolean;
    readonly exclusive: boolean;
    readonly name: string;
    readonly permission: ToolPermission;
    readonly readOnly: boolean;
    readonly scope: readonly ToolScope[];
    readonly source: CapabilitySource;
    readonly sourceId?: string;
    readonly tags?: readonly string[];
}

export interface CapabilityCatalogSnapshot {
    readonly builtAt: string;
    readonly capabilities: readonly CapabilitySummary[];
    readonly failedSources: readonly string[];
    readonly hiddenCapabilities: readonly {
        readonly name: string;
        readonly reasons: readonly ToolHiddenReason[];
    }[];
    readonly staleSources: readonly string[];
    readonly totals: {
        readonly capabilities: number;
        readonly hidden: number;
        readonly pluginCapabilities: number;
        readonly prompts: number;
        readonly resources: number;
        readonly tools: number;
        readonly userTools: number;
    };
}

export interface ExecutiveCapabilityExecutionMetadata {
    readonly capabilityKind: CapabilityExecutionKind;
    readonly error?: string;
    readonly key: string;
    readonly ok: boolean;
    readonly requiresApproval: boolean;
    readonly resultSummary?: string;
}

export interface ExecutiveLoopGuardEvent {
    readonly toolName: string;
    readonly input?: Readonly<Record<string, unknown>>;
    readonly ok?: boolean;
    readonly error?: string;
    readonly knownToolNames?: ReadonlySet<string>;
}

export interface ExecutiveLoopGuardDecision {
    readonly allow: boolean;
    readonly reason?: ExecutiveLoopGuardReason;
    readonly message?: string;
}

export interface ExecutiveLoopGuardSnapshot {
    readonly totalCalls: number;
    readonly unknownToolCounts: Readonly<Record<string, number>>;
    readonly callRepeatCounts: Readonly<Record<string, number>>;
    readonly failedCallRepeatCounts: Readonly<Record<string, number>>;
}

export interface ExecutiveLoopGuardOptions {
    readonly maxCalls?: number;
    readonly maxUnknownToolRepeats?: number;
    readonly maxRepeatedCalls?: number;
    readonly maxFailedCallRepeats?: number;
}
