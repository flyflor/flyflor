export const PROMPT_TEMPLATE_BUNDLE_VERSION = 2;

export const PROMPT_TEMPLATE_MANIFEST_FILE = "template.manifest.json";

export const PROMPT_TEMPLATE_ORDER = [
    "askSchema",
    "behaviorPriority",
    "blackboardAdvisory",
    "blackboardDecision",
    "blackboardRoute",
    "blackboardWorkerEnvelope",
    "blackboardWorkerSystem",
    "crystalReflection",
    "feedbackClassify",
    "memoryAction",
    "memoryConsolidation",
    "memoryHotCompress",
    "memoryContext",
    "memoryDream",
    "memoryWorkContextOffer",
    "memorySkillOffer",
    "mcpContext",
    "mcpSubtaskPlan",
    "mcpToolNeed",
    "mcpToolBudgetExhausted",
    "planningRoute",
    "runtimeAskContinuation",
    "runtimeIdleResume",
    "runtimeEqContext",
    "runtimeContinuationHint",
    "runtimeIdentityContext",
    "scopeRecall",
    "runtimeSystem",
    "skillContext",
] as const;

export type PromptTemplateKey = (typeof PROMPT_TEMPLATE_ORDER)[number];

export interface PromptTemplateDefinition {
    callSite: string;
    filename: string;
    requiredPlaceholders: readonly string[];
}

export interface PromptTemplateManifestEntry {
    key: PromptTemplateKey;
    filename: string;
    requiredPlaceholders: readonly string[];
}

export interface PromptTemplateBundleManifest {
    schemaVersion: number;
    templates: readonly PromptTemplateManifestEntry[];
}

export const PROMPT_TEMPLATE_DEFINITIONS: Record<PromptTemplateKey, PromptTemplateDefinition> = {
    askSchema: {
        callSite: "renderAskSchemaInstructions",
        filename: "ask.schema.md",
        requiredPlaceholders: [],
    },
    behaviorPriority: {
        callSite: "renderBehaviorPriorityInstructions",
        filename: "behavior.priority.md",
        requiredPlaceholders: [],
    },
    blackboardAdvisory: {
        callSite: "renderBlackboardAdvisoryPrompt",
        filename: "blackboard.advisory.md",
        requiredPlaceholders: ["compactRounds", "elapsedMs", "reason", "status", "turnId"],
    },
    blackboardDecision: {
        callSite: "BlackboardModule.returnDecisionToUser",
        filename: "blackboard.decision.md",
        requiredPlaceholders: ["questionCount", "reason", "unresolvedIssues"],
    },
    blackboardRoute: {
        callSite: "decideBlackboardRoute",
        filename: "blackboard.route.md",
        requiredPlaceholders: ["request"],
    },
    blackboardWorkerEnvelope: {
        callSite: "renderBlackboardWorkerEnvelope",
        filename: "blackboard.worker.envelope.md",
        requiredPlaceholders: [
            "contractJson",
            "convergencePolicyJson",
            "currentRoundStepsJson",
            "discussionPlanJson",
            "goalJson",
            "minRoundsJson",
            "participantJson",
            "phaseJson",
            "previousStepsJson",
            "roundJson",
        ],
    },
    blackboardWorkerSystem: {
        callSite: "renderBlackboardWorkerSystemPrompt",
        filename: "blackboard.worker.system.md",
        requiredPlaceholders: ["participant"],
    },
    crystalReflection: {
        callSite: "ReflectionWorker.dispatch",
        filename: "crystal.reflection.md",
        requiredPlaceholders: ["evidence"],
    },
    feedbackClassify: {
        callSite: "classifyAndApplyFeedback",
        filename: "feedback.classify.md",
        requiredPlaceholders: ["currentUserText", "previousAssistantText"],
    },
    memoryAction: {
        callSite: "renderMemoryActionInstructions",
        filename: "memory.action.md",
        requiredPlaceholders: [],
    },
    memoryConsolidation: {
        callSite: "ConsolidationWorker",
        filename: "memory.consolidation.md",
        requiredPlaceholders: ["episode"],
    },
    memoryHotCompress: {
        callSite: "HotMemoryCompressionWorker",
        filename: "memory.hot.compress.md",
        requiredPlaceholders: ["episodes"],
    },
    memoryContext: {
        callSite: "renderMemoryPrompt",
        filename: "memory.context.md",
        requiredPlaceholders: ["hippocampus", "markdownContent", "retrievedResults", "scopeMemory"],
    },
    memoryDream: {
        callSite: "DreamWorker",
        filename: "memory.dream.md",
        requiredPlaceholders: ["candidates", "ownerKey"],
    },
    memoryWorkContextOffer: {
        callSite: "renderWorkContextOfferPrompt",
        filename: "memory.scope.offer.md",
        requiredPlaceholders: ["evidenceScore", "relatedCount", "remainingTurns", "title"],
    },
    memorySkillOffer: {
        callSite: "renderSkillOfferPrompt",
        filename: "memory.skill.offer.md",
        requiredPlaceholders: ["confidence", "name", "remainingTurns", "support", "tools"],
    },
    mcpContext: {
        callSite: "renderMcpContextPrompt",
        filename: "mcp.context.md",
        requiredPlaceholders: ["mcpEntries"],
    },
    mcpSubtaskPlan: {
        callSite: "RuntimeSubtaskPlanComponent.decide",
        filename: "mcp.subtask.plan.md",
        requiredPlaceholders: ["toolCatalogJson", "userRequest"],
    },
    mcpToolNeed: {
        callSite: "RuntimeMcpToolNeedComponent.decide",
        filename: "mcp.tool.need.md",
        requiredPlaceholders: ["assistantDraft", "toolCatalogJson", "userRequest"],
    },
    mcpToolBudgetExhausted: {
        callSite: "renderMcpToolBudgetExhaustedPrompt",
        filename: "mcp.tool.budget.exhausted.md",
        requiredPlaceholders: [],
    },
    planningRoute: {
        callSite: "RuntimePlanningRouteComponent.decide",
        filename: "planning.route.md",
        requiredPlaceholders: ["interactionMode", "request"],
    },
    runtimeAskContinuation: {
        callSite: "renderRuntimeAskContinuationPrompt",
        filename: "runtime.ask.continuation.md",
        requiredPlaceholders: ["chainDepth", "choices", "prompt", "reason"],
    },
    runtimeIdleResume: {
        callSite: "renderRuntimeIdleResumePrompt",
        filename: "runtime.idle.resume.md",
        requiredPlaceholders: ["idleBucket"],
    },
    runtimeEqContext: {
        callSite: "renderRuntimeEqContextPrompt",
        filename: "runtime.eq.context.md",
        requiredPlaceholders: ["ageBucket", "arousal", "confidence", "directive", "dominance", "label", "valence"],
    },
    runtimeContinuationHint: {
        callSite: "renderRuntimeContinuationHintPrompt",
        filename: "runtime.continuation.hint.md",
        requiredPlaceholders: ["continuationEntries"],
    },
    runtimeIdentityContext: {
        callSite: "renderRuntimeIdentityContextPrompt",
        filename: "runtime.identity.context.md",
        requiredPlaceholders: ["identityEntries"],
    },
    scopeRecall: {
        callSite: "ScopeRecallComponent.decide",
        filename: "scope.recall.md",
        requiredPlaceholders: ["candidateJson", "currentContextJson", "request"],
    },
    runtimeSystem: {
        callSite: "renderRuntimeSystemPrompt",
        filename: "runtime.system.md",
        requiredPlaceholders: [
            "askSchemaInstructions",
            "behaviorPriorityInstructions",
            "blackboardContext",
            "mcpContext",
            "memoryActionInstructions",
            "memoryContext",
            "sandboxSummary",
            "skillContext",
        ],
    },
    skillContext: {
        callSite: "renderSkillContextPrompt",
        filename: "skill.context.md",
        requiredPlaceholders: ["skillEntries"],
    },
} as const;

export const PROMPT_TEMPLATE_BUNDLE_MANIFEST: PromptTemplateBundleManifest = {
    schemaVersion: PROMPT_TEMPLATE_BUNDLE_VERSION,
    templates: PROMPT_TEMPLATE_ORDER.map((key) => {
        const spec = PROMPT_TEMPLATE_DEFINITIONS[key];
        return {
            key,
            filename: spec.filename,
            requiredPlaceholders: [...spec.requiredPlaceholders],
        };
    }),
};
