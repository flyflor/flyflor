import { BlackboardWorkerProtocol } from "../../protocol/contracts/enums.ts";

export const PROMPT_TEMPLATE_BUNDLE_VERSION = 2;

export const PROMPT_TEMPLATE_MANIFEST_FILE = "template.manifest.json";

export interface PromptTemplateProtocolSpec {
    expectedOutput: readonly string[];
    constraints: readonly string[];
}

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
    "memoryProjectOffer",
    "memorySkillOffer",
    "mcpContext",
    "runtimeAskContinuation",
    "runtimeDormantResume",
    "runtimeEqContext",
    "runtimeGhostHint",
    "runtimeIdentityContext",
    "runtimeSystem",
    "skillContext",
] as const;

export type PromptTemplateKey = (typeof PROMPT_TEMPLATE_ORDER)[number];

export interface PromptTemplateDefinition {
    callSite: string;
    filename: string;
    protocol?: string;
    protocolSpec?: PromptTemplateProtocolSpec;
    requiredPlaceholders: readonly string[];
    summary: string;
}

export interface PromptTemplateManifestEntry {
    key: PromptTemplateKey;
    filename: string;
    protocol?: string;
    protocolSpec?: PromptTemplateProtocolSpec;
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
        summary: "Structured clarifying questions, ghost decisions, and identity append blocks.",
    },
    behaviorPriority: {
        callSite: "renderBehaviorPriorityInstructions",
        filename: "behavior.priority.md",
        requiredPlaceholders: [],
        summary: "Prompt source ordering and conflict resolution rules.",
    },
    blackboardAdvisory: {
        callSite: "renderBlackboardAdvisoryPrompt",
        filename: "blackboard.advisory.md",
        requiredPlaceholders: ["compactRounds", "elapsedMs", "reason", "status", "turnId"],
        summary: "Advisory transcript for direct-path turns that need blackboard context.",
    },
    blackboardDecision: {
        callSite: "BlackboardModule.returnDecisionToUser",
        filename: "blackboard.decision.md",
        requiredPlaceholders: ["questionCount", "reason", "unresolvedIssues"],
        summary: "Decision prompt when the board needs user confirmation to close a loop.",
    },
    blackboardRoute: {
        callSite: "decideBlackboardRoute",
        filename: "blackboard.route.md",
        requiredPlaceholders: ["request"],
        summary: "Route planner prompt for the blackboard front door.",
    },
    blackboardWorkerEnvelope: {
        callSite: "renderBlackboardWorkerEnvelope",
        filename: "blackboard.worker.envelope.md",
        protocol: BlackboardWorkerProtocol.V1,
        protocolSpec: {
            expectedOutput: [
                "inputSummary",
                "outputSummary",
                "newFacts",
                "blockers",
                "risk",
                "questions",
                "answers",
                "agreement",
                "outcome",
                "openIssues",
                "proposal",
                "discussion",
            ],
            constraints: [
                "no-tool-execution",
                "no-long-term-memory-write",
                "surface-blockers",
                "write-public-discussion-as-dialogue",
                "answer-current-round-peer-questions",
            ],
        },
        requiredPlaceholders: [
            "constraintsJson",
            "contractJson",
            "convergencePolicyJson",
            "currentRoundStepsJson",
            "discussionPlanJson",
            "goalJson",
            "expectedOutputJson",
            "minRoundsJson",
            "participantJson",
            "phaseJson",
            "previousStepsJson",
            "roundJson",
        ],
        summary: "User task envelope for a single blackboard worker participant.",
    },
    blackboardWorkerSystem: {
        callSite: "renderBlackboardWorkerSystemPrompt",
        filename: "blackboard.worker.system.md",
        requiredPlaceholders: ["participant"],
        summary: "System prompt for a single blackboard worker participant.",
    },
    crystalReflection: {
        callSite: "ReflectionWorker.dispatch",
        filename: "crystal.reflection.md",
        requiredPlaceholders: ["evidence"],
        summary: "Reflection prompt that extracts reusable methods from evidence.",
    },
    feedbackClassify: {
        callSite: "classifyAndApplyFeedback",
        filename: "feedback.classify.md",
        requiredPlaceholders: ["currentUserText", "previousAssistantText"],
        summary: "Feedback classifier that buckets the latest user message.",
    },
    memoryAction: {
        callSite: "renderMemoryActionInstructions",
        filename: "memory.action.md",
        requiredPlaceholders: [],
        summary: "Durable Markdown memory tool block schema.",
    },
    memoryConsolidation: {
        callSite: "ConsolidationWorker",
        filename: "memory.consolidation.md",
        requiredPlaceholders: ["episode"],
        summary: "Episode classification prompt for consolidation.",
    },
    memoryHotCompress: {
        callSite: "HotMemoryCompressionWorker",
        filename: "memory.hot.compress.md",
        requiredPlaceholders: ["episodes"],
        summary: "Audit-only compression prompt for expiring working-memory episodes.",
    },
    memoryContext: {
        callSite: "renderMemoryPrompt",
        filename: "memory.context.md",
        requiredPlaceholders: ["hippocampus", "markdownContent", "projectMemory", "retrievedResults"],
        summary: "Memory context wrapper for recent, project, long-term, and global layers.",
    },
    memoryDream: {
        callSite: "DreamWorker",
        filename: "memory.dream.md",
        requiredPlaceholders: ["candidates", "userId"],
        summary: "Quiet maintenance prompt for long-term drift, recall, and contradiction work.",
    },
    memoryProjectOffer: {
        callSite: "renderProjectOfferPrompt",
        filename: "memory.project.offer.md",
        requiredPlaceholders: ["evidenceScore", "relatedCount", "remainingTurns", "title"],
        summary: "Runtime nudge for a project candidate awaiting user confirmation.",
    },
    memorySkillOffer: {
        callSite: "renderSkillOfferPrompt",
        filename: "memory.skill.offer.md",
        requiredPlaceholders: ["confidence", "name", "remainingTurns", "support", "tools"],
        summary: "Runtime nudge for a reusable skill candidate awaiting user confirmation.",
    },
    mcpContext: {
        callSite: "renderMcpContextPrompt",
        filename: "mcp.context.md",
        requiredPlaceholders: ["mcpEntries"],
        summary: "MCP capability wrapper and tool-context listing.",
    },
    runtimeAskContinuation: {
        callSite: "renderRuntimeAskContinuationPrompt",
        filename: "runtime.ask.continuation.md",
        requiredPlaceholders: ["chainDepth", "choices", "prompt", "reason"],
        summary: "Runtime continuation hint for an active pending ask.",
    },
    runtimeDormantResume: {
        callSite: "renderRuntimeDormantResumePrompt",
        filename: "runtime.dormant.resume.md",
        requiredPlaceholders: ["idleBucket"],
        summary: "Runtime resume hint after a dormant interval.",
    },
    runtimeEqContext: {
        callSite: "renderRuntimeEqContextPrompt",
        filename: "runtime.eq.context.md",
        requiredPlaceholders: ["ageBucket", "arousal", "confidence", "directive", "dominance", "label", "valence"],
        summary: "Tone-only emotional context hint.",
    },
    runtimeGhostHint: {
        callSite: "renderRuntimeGhostHintPrompt",
        filename: "runtime.ghost.hint.md",
        requiredPlaceholders: ["ghostEntries"],
        summary: "Runtime hint for active unfinished contexts.",
    },
    runtimeIdentityContext: {
        callSite: "renderRuntimeIdentityContextPrompt",
        filename: "runtime.identity.context.md",
        requiredPlaceholders: ["identityEntries"],
        summary: "Runtime identity context assembled from live identity entries.",
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
        summary: "Top-level runtime system prompt assembled for every turn.",
    },
    skillContext: {
        callSite: "renderSkillContextPrompt",
        filename: "skill.context.md",
        requiredPlaceholders: ["skillEntries"],
        summary: "Skill wrapper prompt that formats loaded SKILL.md entries.",
    },
} as const;

export const PROMPT_TEMPLATE_BUNDLE_MANIFEST: PromptTemplateBundleManifest = {
    schemaVersion: PROMPT_TEMPLATE_BUNDLE_VERSION,
    templates: PROMPT_TEMPLATE_ORDER.map((key) => {
        const spec = PROMPT_TEMPLATE_DEFINITIONS[key];
        return {
            key,
            filename: spec.filename,
            ...(spec.protocol ? { protocol: spec.protocol } : {}),
            ...(spec.protocolSpec ? { protocolSpec: spec.protocolSpec } : {}),
            requiredPlaceholders: [...spec.requiredPlaceholders],
        };
    }),
};
