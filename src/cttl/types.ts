import type {
    CttlCapabilitySource,
    CttlHiddenReason,
    CttlLoopGuardReason,
    CttlPermission,
    CttlToolCategory,
    CttlToolScope,
    CttlTrustSurface,
} from "../protocol/contracts/index.ts";

export type CttlJsonPrimitive = string | number | boolean | null;
export type CttlJsonValue =
    | CttlJsonPrimitive
    | readonly CttlJsonValue[]
    | { readonly [key: string]: CttlJsonValue };
export type CttlJsonObject = { readonly [key: string]: CttlJsonValue };

export interface CttlResultLimit {
    maxChars: number;
}

export interface CttlToolDescriptor {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: CttlJsonObject;
    readonly outputSchema?: CttlJsonObject;
    readonly source: CttlCapabilitySource;
    readonly scope: readonly CttlToolScope[];
    readonly permission: CttlPermission;
    readonly category: CttlToolCategory;
    readonly readOnly: boolean;
    readonly concurrencySafe: boolean;
    readonly exclusive: boolean;
    readonly resultLimit: CttlResultLimit;
    readonly sourceId?: string;
    readonly tags?: readonly string[];
}

export interface CttlRegisteredTool {
    readonly descriptor: CttlToolDescriptor;
    readonly execute?: CttlToolExecutor;
}

export interface CttlToolExecutorInput {
    readonly input: CttlJsonObject;
    readonly requestId?: string;
}

export interface CttlToolExecutorResult {
    readonly ok: boolean;
    readonly output?: CttlJsonValue;
    readonly error?: string;
}

export type CttlToolExecutor = (input: CttlToolExecutorInput) => Promise<CttlToolExecutorResult> | CttlToolExecutorResult;

export interface CttlTrustContext {
    readonly allowedSources?: ReadonlySet<CttlCapabilitySource>;
    readonly allowedScopes?: ReadonlySet<CttlToolScope>;
    readonly maxPermission?: CttlPermission;
    readonly deniedTools?: ReadonlySet<string>;
    readonly unavailableTools?: ReadonlySet<string>;
}

export interface CttlTrustPolicyInput {
    readonly surface: CttlTrustSurface;
    readonly projectScoped?: boolean;
    readonly debug?: boolean;
    readonly allowedSources?: readonly CttlCapabilitySource[];
    readonly maxPermission?: CttlPermission;
    readonly deniedTools?: readonly string[];
    readonly unavailableTools?: readonly string[];
}

export interface CttlToolPlanEntry {
    readonly descriptor: CttlToolDescriptor;
}

export interface CttlHiddenToolPlanEntry {
    readonly descriptor: CttlToolDescriptor;
    readonly diagnostics: readonly CttlToolPlanDiagnostic[];
}

export interface CttlToolPlanDiagnostic {
    readonly reason: CttlHiddenReason;
    readonly message: string;
}

export interface CttlToolPlan {
    readonly visible: readonly CttlToolPlanEntry[];
    readonly hidden: readonly CttlHiddenToolPlanEntry[];
}

export interface CttlCapabilitySummary {
    readonly category: CttlToolCategory;
    readonly concurrencySafe: boolean;
    readonly exclusive: boolean;
    readonly name: string;
    readonly permission: CttlPermission;
    readonly readOnly: boolean;
    readonly scope: readonly CttlToolScope[];
    readonly source: CttlCapabilitySource;
    readonly sourceId?: string;
    readonly tags?: readonly string[];
}

export interface CttlCapabilityCatalogSnapshot {
    readonly builtAt: string;
    readonly capabilities: readonly CttlCapabilitySummary[];
    readonly failedSources: readonly string[];
    readonly hiddenCapabilities: readonly {
        readonly name: string;
        readonly reasons: readonly CttlHiddenReason[];
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

export interface CttlLoopGuardEvent {
    readonly toolName: string;
    readonly input?: Readonly<Record<string, unknown>>;
    readonly ok?: boolean;
    readonly error?: string;
    readonly knownToolNames?: ReadonlySet<string>;
}

export interface CttlLoopGuardDecision {
    readonly allow: boolean;
    readonly reason?: CttlLoopGuardReason;
    readonly message?: string;
}

export interface CttlLoopGuardSnapshot {
    readonly totalCalls: number;
    readonly unknownToolCounts: Readonly<Record<string, number>>;
    readonly callRepeatCounts: Readonly<Record<string, number>>;
    readonly failedCallRepeatCounts: Readonly<Record<string, number>>;
}

export interface CttlLoopGuardOptions {
    readonly maxCalls?: number;
    readonly maxUnknownToolRepeats?: number;
    readonly maxRepeatedCalls?: number;
    readonly maxFailedCallRepeats?: number;
}
