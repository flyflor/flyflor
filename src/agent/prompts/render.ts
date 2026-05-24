import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";
import type { BlackboardDiscussionPlan } from "../../protocol/contracts/index.ts";
import type { BlackboardMode } from "../../protocol/contracts/index.ts";
import {
    PROMPT_TEMPLATE_BUNDLE_MANIFEST,
    PROMPT_TEMPLATE_BUNDLE_VERSION,
    PROMPT_TEMPLATE_DEFINITIONS,
    PROMPT_TEMPLATE_MANIFEST_FILE,
    PROMPT_TEMPLATE_ORDER,
    type PromptTemplateBundleManifest,
    type PromptTemplateKey,
} from "./template.manifest.ts";

export interface RuntimeSystemPromptInput {
    askSchemaInstructions: string;
    behaviorPriorityInstructions: string;
    blackboardContext: string;
    mcpContext: string;
    memoryActionInstructions: string;
    memoryContext: string;
    sandboxSummary: string;
    skillContext: string;
}

export interface SkillContextPromptInput {
    skills: Array<{
        body: string;
        description: string;
        name: string;
    }>;
}

export interface McpContextPromptInput {
    servers: Array<{
        args?: string[];
        command?: string;
        enabled: boolean;
        name: string;
        url?: string;
    }>;
    toolContext?: string;
}

export interface McpToolBudgetExhaustedPromptInput {}

export interface McpToolNeedPromptInput {
    assistantDraft: string;
    toolCatalogJson: string;
    userRequest: string;
}

export interface McpSubtaskPlanPromptInput {
    toolCatalogJson: string;
    userRequest: string;
}

export interface BlackboardAdvisoryPromptInput {
    compactRounds?: string[];
    configured: boolean;
    elapsedMs?: number;
    mode?: BlackboardMode;
    reason?: string;
    status?: string;
    turnId?: string;
}

export interface BlackboardRoutePromptInput {
    request: string;
}

export interface PlanningRoutePromptInput {
    interactionMode: string;
    request: string;
}

export interface BlackboardWorkerEnvelopeInput {
    contract: unknown;
    convergencePolicy: unknown;
    currentRoundSteps: unknown[];
    discussionPlan: BlackboardDiscussionPlan;
    goal: string;
    minRounds: number;
    participant: string;
    phase: string;
    previousSteps: unknown[];
    round: number;
}

export interface BlackboardWorkerSystemPromptInput {
    participant: string;
}

export interface MemoryContextPromptInput {
    hippocampus: string;
    markdown: string;
    scopeMemory: string;
    renderedResults: string;
}

export interface CrystalReflectionPromptInput {
    evidence: string;
}

export interface MemoryConsolidationPromptInput {
    episode: string;
}

export interface HotMemoryCompressionPromptInput {
    episodes: string;
}

export interface MemoryDreamPromptInput {
    ownerKey: string;
    candidates: string;
}

export interface FeedbackClassifyPromptInput {
    previousAssistantText: string;
    currentUserText: string;
}

export interface BlackboardDecisionPromptInput {
    reason: string;
    unresolvedIssues: string[];
}

export interface RuntimeIdleResumePromptInput {
    idleBucket: string;
}

export interface RuntimeEqContextPromptInput {
    ageBucket: string;
    arousal: string;
    confidence: string;
    directive: string;
    dominance: string;
    label: string;
    valence: string;
}

export interface RuntimeAskContinuationPromptInput {
    chainDepth: string;
    choices: string;
    prompt: string;
    reason: string;
}

export interface RuntimeContinuationHintPromptInput {
    continuationEntries: string;
}

export interface RuntimeIdentityContextPromptInput {
    identityEntries: string;
}

export interface WorkContextOfferPromptInput {
    evidenceScore: string;
    relatedCount: string;
    remainingTurns: string;
    title: string;
}

export interface SkillOfferPromptInput {
    confidence: string;
    name: string;
    remainingTurns: string;
    support: string;
    tools: string;
}

export interface ScopeRecallPromptInput {
    candidateJson: string;
    currentContextJson: string;
    request: string;
}

interface PromptTemplate {
    content: string;
    filename: string;
}

type PromptTemplateMap = Record<PromptTemplateKey, PromptTemplate>;

const PROMPT_TEMPLATE_FILES: Record<PromptTemplateKey, string> = Object.fromEntries(
    PROMPT_TEMPLATE_ORDER.map((key) => [key, PROMPT_TEMPLATE_DEFINITIONS[key].filename]),
) as Record<PromptTemplateKey, string>;

let promptTemplates: PromptTemplateMap | undefined;
let promptTemplatesDir: string | undefined;
let promptTemplatesSignature: string | undefined;

export async function loadPromptTemplates(paths: FlyflorPaths, options: { force?: boolean } = {}): Promise<void> {
    // 启动期由 app.ts 加载一次；热路径（runtime / memory.buildPrompt）的后续调用直接复用缓存。
    // 缓存键 = promptDir + 所有模板的 mtime 签名；任意一个文件被改写都会自动失效，
    // 同时不依赖 fs.watch（避免 bun 编译 binary 在容器里跨挂载点 watch 的兼容性问题）。
    const signature = options.force ? undefined : await readSignature(paths.promptDir);
    if (
        !options.force &&
        promptTemplates &&
        promptTemplatesDir === paths.promptDir &&
        signature !== undefined &&
        signature === promptTemplatesSignature
    ) {
        return;
    }
    const manifest = await readPromptTemplateManifest(paths.promptDir);
    if (manifest.schemaVersion !== PROMPT_TEMPLATE_BUNDLE_VERSION) {
        throw new Error(
            `Prompt template bundle schemaVersion ${manifest.schemaVersion} does not match runtime ${PROMPT_TEMPLATE_BUNDLE_VERSION}. Run "bun run install:templates" to refresh templates/prompts.`,
        );
    }
    const loaded = {} as PromptTemplateMap;
    for (const key of PROMPT_TEMPLATE_ORDER) {
        const filename = PROMPT_TEMPLATE_FILES[key];
        const path = join(paths.promptDir, filename);
        const file = Bun.file(path);
        if (!(await file.exists())) {
            throw new Error(
                `Missing prompt template: ${path}. Run "bun run install:templates" or copy templates/prompts.`,
            );
        }
        const content = (await file.text()).trim();
        if (!content) {
            throw new Error(`Empty prompt template: ${path}.`);
        }
        loaded[key] = {
            filename,
            content,
        };
    }
    promptTemplates = loaded;
    promptTemplatesDir = paths.promptDir;
    promptTemplatesSignature = signature ?? (await readSignature(paths.promptDir));
}

async function readSignature(promptDir: string): Promise<string> {
    // 用所有模板文件的 mtime + size 拼接出 fingerprint；任何编辑都会改变 signature。
    // 比 fs.watch 简单可靠（同步快照），命中失败时只是退回完整加载，开销可忽略。
    const parts: string[] = [];
    const manifestPath = join(promptDir, PROMPT_TEMPLATE_MANIFEST_FILE);
    try {
        const stat = await Bun.file(manifestPath).stat();
        parts.push(`${PROMPT_TEMPLATE_MANIFEST_FILE}:${stat.mtimeMs}:${stat.size}`);
    } catch {
        parts.push(`${PROMPT_TEMPLATE_MANIFEST_FILE}:missing`);
    }
    for (const key of PROMPT_TEMPLATE_ORDER) {
        const filename = PROMPT_TEMPLATE_FILES[key];
        const path = join(promptDir, filename);
        try {
            const stat = await Bun.file(path).stat();
            parts.push(`${filename}:${stat.mtimeMs}:${stat.size}`);
        } catch {
            parts.push(`${filename}:missing`);
        }
    }
    return parts.join("|");
}

export function renderRuntimeSystemPrompt(input: RuntimeSystemPromptInput): string {
    // 必要提示词：这里是模型上下文唯一装配口；业务控制仍由 schema、枚举和状态机完成。
    return renderTemplate(requiredTemplates().runtimeSystem.content, {
        askSchemaInstructions: input.askSchemaInstructions,
        behaviorPriorityInstructions: input.behaviorPriorityInstructions,
        blackboardContext: input.blackboardContext,
        mcpContext: input.mcpContext,
        memoryActionInstructions: input.memoryActionInstructions,
        memoryContext: input.memoryContext,
        sandboxSummary: input.sandboxSummary,
        skillContext: input.skillContext,
    });
}

export function renderMemoryActionInstructions(): string {
    // 必要提示词：当前模型 API 没有独立 memory tool 调用通道，临时用英文块协议承载结构化写入请求。
    return requiredTemplates().memoryAction.content;
}

export function renderAskSchemaInstructions(): string {
    // 必要提示词：澄清问题 + 未完成事项元数据。同 memory.action 一样走块协议承载结构化输出。
    return requiredTemplates().askSchema.content;
}

export function renderBehaviorPriorityInstructions(): string {
    // 提示词优先级冲突表。这里只注入声明式优先级；runtime 仍不做业务语义字符串判断。
    return requiredTemplates().behaviorPriority.content;
}

export function renderSkillContextPrompt(input: SkillContextPromptInput): string {
    // 必要提示词：Skill Markdown 是用户或工作区提供的能力说明；这里只做上下文格式化，不控制运行时收敛。
    return renderTemplate(requiredTemplates().skillContext.content, {
        skillEntries: input.skills
            .map((skill) => `## ${skill.name}\n${skill.description}\n\n${skill.body.trim()}`)
            .join("\n\n"),
    });
}

export function renderMcpContextPrompt(input: McpContextPromptInput): string {
    // 必要提示词：这里只告知已配置 MCP 端点；实际工具执行仍必须通过后续 sandbox/MCP 协议边界。
    const enabled = input.servers.filter((server) => server.enabled);
    return renderTemplate(requiredTemplates().mcpContext.content, {
        mcpEntries:
            input.toolContext ??
            enabled
                .map((server) => {
                    const target = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
                    return `- ${server.name}: ${target}`;
                })
                .join("\n"),
    });
}

export function renderMcpToolNeedPrompt(input: McpToolNeedPromptInput): string {
    // Dedicated model gate: Runtime consumes only the JSON decision and catalog tool ids,
    // then sends any selected calls back through Executive/Sandbox instead of trusting prose.
    return renderTemplate(requiredTemplates().mcpToolNeed.content, {
        assistantDraft: input.assistantDraft,
        toolCatalogJson: input.toolCatalogJson,
        userRequest: input.userRequest,
    });
}

export function renderMcpSubtaskPlanPrompt(input: McpSubtaskPlanPromptInput): string {
    // Dedicated model gate: decides whether a request should be wrapped in one
    // parent subtask batch before the normal tool loop spends individual turns.
    return renderTemplate(requiredTemplates().mcpSubtaskPlan.content, {
        toolCatalogJson: input.toolCatalogJson,
        userRequest: input.userRequest,
    });
}

export function renderMcpToolBudgetExhaustedPrompt(_input: McpToolBudgetExhaustedPromptInput = {}): string {
    return requiredTemplates().mcpToolBudgetExhausted.content;
}

export function renderBlackboardAdvisoryPrompt(input: BlackboardAdvisoryPromptInput): string {
    // 必要提示词：主模型只看到黑板的事实性摘要；是否收敛由 BlackboardModule 判断。
    if (!input.configured) {
        return renderTemplate(requiredTemplates().blackboardAdvisory.content, {
            compactRounds: "",
            elapsedMs: String(input.elapsedMs ?? 0),
            reason: "not-configured",
            status: "disabled",
            turnId: input.turnId ?? "unknown",
        });
    }
    if (input.mode === "direct") {
        return renderTemplate(requiredTemplates().blackboardAdvisory.content, {
            compactRounds: "",
            elapsedMs: String(input.elapsedMs ?? 0),
            reason: input.reason ?? "direct-route",
            status: "direct",
            turnId: input.turnId ?? "unknown",
        });
    }
    return renderTemplate(requiredTemplates().blackboardAdvisory.content, {
        compactRounds: (input.compactRounds ?? []).join("\n"),
        elapsedMs: String(input.elapsedMs ?? 0),
        reason: input.reason ?? "unknown",
        status: input.status ?? "unknown",
        turnId: input.turnId ?? "unknown",
    });
}

export function renderBlackboardRoutePrompt(input: BlackboardRoutePromptInput): string {
    // 必要提示词：路由语义由模型基于本轮请求归纳；代码只校验结构化 mode/score，不写业务分类表。
    return renderTemplate(requiredTemplates().blackboardRoute.content, {
        request: input.request,
    });
}

export function renderPlanningRoutePrompt(input: PlanningRoutePromptInput): string {
    // Dedicated model gate: runtime consumes only JSON fields and never uses text matching
    // to decide whether a turn must stop at a user-confirmed plan.
    return renderTemplate(requiredTemplates().planningRoute.content, {
        interactionMode: input.interactionMode,
        request: input.request,
    });
}

export function renderBlackboardWorkerEnvelope(input: BlackboardWorkerEnvelopeInput): string {
    // 必要提示词：worker 会把该 JSON 作为 ModelRole.User 输入；字段说明、输出字段和约束都由模板承载。
    return renderTemplate(requiredTemplates().blackboardWorkerEnvelope.content, {
        contractJson: promptJson(input.contract),
        convergencePolicyJson: promptJson(input.convergencePolicy),
        currentRoundStepsJson: promptJson(input.currentRoundSteps),
        discussionPlanJson: promptJson(input.discussionPlan),
        goalJson: promptJson(input.goal),
        minRoundsJson: promptJson(input.minRounds),
        participantJson: promptJson(input.participant),
        phaseJson: promptJson(input.phase),
        previousStepsJson: promptJson(input.previousSteps),
        roundJson: promptJson(input.round),
    });
}

export function renderBlackboardWorkerSystemPrompt(input: BlackboardWorkerSystemPromptInput): string {
    // 必要提示词：模型型 worker 只能靠最小英文协议约束返回结构化 result；收敛由 BlackboardModule 的状态机裁决。
    return renderTemplate(requiredTemplates().blackboardWorkerSystem.content, {
        participant: input.participant,
    });
}

export function renderMemoryContextPrompt(input: MemoryContextPromptInput): string {
    // 必要提示词：这里只标注记忆来源和不可信边界，写入门槛仍由结构化 memory_action 决定。
    return renderTemplate(requiredTemplates().memoryContext.content, {
        hippocampus: input.hippocampus,
        markdownContent: input.markdown,
        scopeMemory: input.scopeMemory,
        retrievedResults: input.renderedResults,
    });
}

export function renderCrystalReflectionPrompt(input: CrystalReflectionPromptInput): string {
    // 必要提示词：反思 worker 只收到最小英文抽取要求；桶、符号和坐标必须从证据中生成，代码不提供固定分类。
    return renderTemplate(requiredTemplates().crystalReflection.content, {
        evidence: input.evidence,
    });
}

export function renderMemoryConsolidationPrompt(input: MemoryConsolidationPromptInput): string {
    // 必要提示词：工作记忆候选分类器；决策由结构化 JSON 输出承载，代码只做枚举校验，不做语义匹配。
    return renderTemplate(requiredTemplates().memoryConsolidation.content, {
        episode: input.episode,
    });
}

export function renderHotMemoryCompressionPrompt(input: HotMemoryCompressionPromptInput): string {
    // 必要提示词：到期工作记忆压缩器；输出仅用于隔离审计，不进入长期记忆或召回。
    return renderTemplate(requiredTemplates().memoryHotCompress.content, {
        episodes: input.episodes,
    });
}

export function renderMemoryDreamPrompt(input: MemoryDreamPromptInput): string {
    // 必要提示词：长期概念图维护 worker；drift-repair / recall-reinforce / contradiction-audit / skip
    // 由结构化 JSON 输出承载，代码不做语义匹配，只校验 enum + JSON shape（README.md §12）。
    return renderTemplate(requiredTemplates().memoryDream.content, {
        ownerKey: input.ownerKey,
        candidates: input.candidates,
    });
}

export function renderFeedbackClassifyPrompt(input: FeedbackClassifyPromptInput): string {
    // 必要提示词：用户反馈五分类；类别集合由模板约束，代码只校验 enum + JSON shape。
    return renderTemplate(requiredTemplates().feedbackClassify.content, {
        previousAssistantText: input.previousAssistantText,
        currentUserText: input.currentUserText,
    });
}

export function renderBlackboardDecisionPrompt(input: BlackboardDecisionPromptInput): string {
    // 必要提示词：这是交还用户的表单问题文本，不参与模型收敛裁决。
    return renderTemplate(requiredTemplates().blackboardDecision.content, {
        questionCount: String(input.unresolvedIssues.length),
        reason: input.reason,
        unresolvedIssues: input.unresolvedIssues.map((issue, index) => `${index + 1}. ${issue}`).join("\n"),
    });
}

export function renderRuntimeIdleResumePrompt(input: RuntimeIdleResumePromptInput): string {
    return renderTemplate(requiredTemplates().runtimeIdleResume.content, {
        idleBucket: input.idleBucket,
    });
}

export function renderRuntimeEqContextPrompt(input: RuntimeEqContextPromptInput): string {
    return renderTemplate(requiredTemplates().runtimeEqContext.content, {
        ageBucket: input.ageBucket,
        arousal: input.arousal,
        confidence: input.confidence,
        directive: input.directive,
        dominance: input.dominance,
        label: input.label,
        valence: input.valence,
    });
}

export function renderRuntimeAskContinuationPrompt(input: RuntimeAskContinuationPromptInput): string {
    return renderTemplate(requiredTemplates().runtimeAskContinuation.content, {
        chainDepth: input.chainDepth,
        choices: input.choices,
        prompt: input.prompt,
        reason: input.reason,
    });
}

export function renderRuntimeContinuationHintPrompt(input: RuntimeContinuationHintPromptInput): string {
    return renderTemplate(requiredTemplates().runtimeContinuationHint.content, {
        continuationEntries: input.continuationEntries,
    });
}

export function renderRuntimeIdentityContextPrompt(input: RuntimeIdentityContextPromptInput): string {
    return renderTemplate(requiredTemplates().runtimeIdentityContext.content, {
        identityEntries: input.identityEntries,
    });
}

export function renderScopeRecallPrompt(input: ScopeRecallPromptInput): string {
    // Scope recall is the semantic gate before scope memory assembly. The runtime
    // only accepts the returned JSON decision; vector hits are candidate evidence,
    // never a keyword trigger.
    return renderTemplate(requiredTemplates().scopeRecall.content, {
        candidateJson: input.candidateJson,
        currentContextJson: input.currentContextJson,
        request: input.request,
    });
}

export function renderWorkContextOfferPrompt(input: WorkContextOfferPromptInput): string {
    return renderTemplate(requiredTemplates().memoryWorkContextOffer.content, {
        evidenceScore: input.evidenceScore,
        relatedCount: input.relatedCount,
        remainingTurns: input.remainingTurns,
        title: input.title,
    });
}

export function renderSkillOfferPrompt(input: SkillOfferPromptInput): string {
    return renderTemplate(requiredTemplates().memorySkillOffer.content, {
        confidence: input.confidence,
        name: input.name,
        remainingTurns: input.remainingTurns,
        support: input.support,
        tools: input.tools,
    });
}

function requiredTemplates(): PromptTemplateMap {
    if (!promptTemplates) {
        throw new Error(`Prompt templates are not loaded. Run "bun run install:templates" before starting Flyflor.`);
    }
    return promptTemplates;
}

export function renderBlackboardDecisionOptions(): Array<{ id: string; label: string; description: string }> {
    return [
        {
            id: "narrow-scope",
            label: "Narrow scope",
            description: "Continue after the user provides a smaller goal or clearer boundary.",
        },
        {
            id: "provide-missing-info",
            label: "Provide missing info",
            description:
                "Continue after the user provides the facts, credentials, paths, or choices required by the blocker.",
        },
        {
            id: "accept-risk",
            label: "Accept risk",
            description: "Continue after the user accepts the risk; sandbox and tool boundaries still apply.",
        },
    ];
}

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/gu, (match, key: string) => values[key] ?? match).trim();
}

/** 每个模板必须出现的占位符集合；任一缺失即视为旧模板，需提示用户升级。 */
const REQUIRED_PLACEHOLDERS: Record<PromptTemplateKey, readonly string[]> = {
    askSchema: [],
    behaviorPriority: [],
    blackboardAdvisory: ["compactRounds", "elapsedMs", "reason", "status", "turnId"],
    blackboardDecision: ["questionCount", "reason", "unresolvedIssues"],
    blackboardRoute: ["request"],
    blackboardWorkerEnvelope: [
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
    blackboardWorkerSystem: ["participant"],
    crystalReflection: ["evidence"],
    feedbackClassify: ["currentUserText", "previousAssistantText"],
    mcpContext: ["mcpEntries"],
    mcpSubtaskPlan: ["toolCatalogJson", "userRequest"],
    mcpToolNeed: ["assistantDraft", "toolCatalogJson", "userRequest"],
    memoryAction: [],
    memoryConsolidation: ["episode"],
    memoryHotCompress: ["episodes"],
    memoryContext: ["hippocampus", "markdownContent", "retrievedResults", "scopeMemory"],
    memoryDream: ["candidates", "ownerKey"],
    memoryWorkContextOffer: ["evidenceScore", "relatedCount", "remainingTurns", "title"],
    memorySkillOffer: ["confidence", "name", "remainingTurns", "support", "tools"],
    runtimeAskContinuation: ["chainDepth", "choices", "prompt", "reason"],
    mcpToolBudgetExhausted: [],
    runtimeIdleResume: ["idleBucket"],
    runtimeEqContext: ["ageBucket", "arousal", "confidence", "directive", "dominance", "label", "valence"],
    runtimeContinuationHint: ["continuationEntries"],
    runtimeIdentityContext: ["identityEntries"],
    scopeRecall: ["candidateJson", "currentContextJson", "request"],
    planningRoute: ["interactionMode", "request"],
    runtimeSystem: [
        "askSchemaInstructions",
        "behaviorPriorityInstructions",
        "blackboardContext",
        "mcpContext",
        "memoryActionInstructions",
        "memoryContext",
        "sandboxSummary",
        "skillContext",
    ],
    skillContext: ["skillEntries"],
};

export interface PromptTemplateLintIssue {
    key: PromptTemplateKey | "manifest" | "directory";
    filename: string;
    path: string;
    kind:
        | "missing-file"
        | "empty-file"
        | "missing-placeholder"
        | "unknown-file"
        | "missing-manifest"
        | "outdated-manifest"
        | "manifest-template-mismatch"
        | "unread-error";
    detail: string;
}

export interface PromptTemplateLintReport {
    ok: boolean;
    promptDir: string;
    issues: PromptTemplateLintIssue[];
    checked: PromptTemplateKey[];
}

/**
 * 校验 `<promptDir>` 下所有提示词模板：
 *   - 存在；
 *   - 非空；
 *   - 包含本版本 runtime 渲染必需的占位符（`{{name}}`）；
 *   - 目录内没有未登记的 Markdown prompt 文件。
 *
 * 任何一项不满足即返回 `ok=false` + 详细 issue 列表，供 `flyflor doctor` 或
 * `bun run install:templates` 升级流程参考。本函数纯读，不修复任何文件。
 */
export async function lintPromptTemplates(paths: FlyflorPaths): Promise<PromptTemplateLintReport> {
    const issues: PromptTemplateLintIssue[] = [];
    const checked: PromptTemplateKey[] = [];
    await lintUnknownPromptFiles(paths.promptDir, issues);
    const manifestPath = join(paths.promptDir, PROMPT_TEMPLATE_MANIFEST_FILE);
    const manifestFile = Bun.file(manifestPath);
    if (!(await manifestFile.exists())) {
        issues.push({
            key: "manifest",
            filename: PROMPT_TEMPLATE_MANIFEST_FILE,
            path: manifestPath,
            kind: "missing-manifest",
            detail: "prompt bundle manifest does not exist",
        });
    } else {
        try {
            const manifest = await readPromptTemplateManifest(paths.promptDir);
            if (manifest.schemaVersion !== PROMPT_TEMPLATE_BUNDLE_VERSION) {
                issues.push({
                    key: "manifest",
                    filename: PROMPT_TEMPLATE_MANIFEST_FILE,
                    path: manifestPath,
                    kind: "outdated-manifest",
                    detail: `schemaVersion ${String(manifest.schemaVersion)} does not match runtime ${PROMPT_TEMPLATE_BUNDLE_VERSION}`,
                });
            }
            const mismatch = diffPromptTemplateManifest(manifest);
            if (mismatch) {
                issues.push({
                    key: "manifest",
                    filename: PROMPT_TEMPLATE_MANIFEST_FILE,
                    path: manifestPath,
                    kind: "manifest-template-mismatch",
                    detail: mismatch,
                });
            }
        } catch (err) {
            issues.push({
                key: "manifest",
                filename: PROMPT_TEMPLATE_MANIFEST_FILE,
                path: manifestPath,
                kind: "unread-error",
                detail: String(err),
            });
        }
    }
    for (const key of PROMPT_TEMPLATE_ORDER) {
        checked.push(key);
        const filename = PROMPT_TEMPLATE_FILES[key];
        const path = join(paths.promptDir, filename);
        const file = Bun.file(path);
        if (!(await file.exists())) {
            issues.push({ key, filename, path, kind: "missing-file", detail: "file does not exist" });
            continue;
        }
        let text = "";
        try {
            text = (await file.text()).trim();
        } catch (err) {
            issues.push({ key, filename, path, kind: "unread-error", detail: String(err) });
            continue;
        }
        if (!text) {
            issues.push({ key, filename, path, kind: "empty-file", detail: "file is empty after trim" });
            continue;
        }
        for (const placeholder of REQUIRED_PLACEHOLDERS[key]) {
            const pattern = new RegExp(`\\{\\{\\s*${placeholder}\\s*\\}\\}`, "u");
            if (!pattern.test(text)) {
                issues.push({
                    key,
                    filename,
                    path,
                    kind: "missing-placeholder",
                    detail: `missing required placeholder {{${placeholder}}}`,
                });
            }
        }
    }
    return { ok: issues.length === 0, promptDir: paths.promptDir, issues, checked };
}

async function lintUnknownPromptFiles(promptDir: string, issues: PromptTemplateLintIssue[]): Promise<void> {
    const expected = new Set<string>([
        PROMPT_TEMPLATE_MANIFEST_FILE,
        ...PROMPT_TEMPLATE_ORDER.flatMap((key) => {
            const spec = PROMPT_TEMPLATE_DEFINITIONS[key];
            return [spec.filename, mirrorPromptFilename(spec.filename)];
        }),
    ]);
    let entries: Array<{ isFile: () => boolean; name: string }> = [];
    try {
        entries = await readdir(promptDir, { withFileTypes: true });
    } catch (err) {
        issues.push({
            key: "directory",
            filename: ".",
            path: promptDir,
            kind: "unread-error",
            detail: String(err),
        });
        return;
    }
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.endsWith(".zh.cn.md")) continue;
        if (!entry.name.endsWith(".md") && entry.name !== PROMPT_TEMPLATE_MANIFEST_FILE) continue;
        if (expected.has(entry.name)) continue;
        issues.push({
            key: "directory",
            filename: entry.name,
            path: join(promptDir, entry.name),
            kind: "unknown-file",
            detail: "prompt file is not registered in template manifest",
        });
    }
}

function mirrorPromptFilename(filename: string): string {
    return filename.endsWith(".md") ? filename.replace(/\.md$/u, ".zh.cn.md") : filename;
}

async function readPromptTemplateManifest(promptDir: string): Promise<PromptTemplateBundleManifest> {
    const path = join(promptDir, PROMPT_TEMPLATE_MANIFEST_FILE);
    const file = Bun.file(path);
    if (!(await file.exists())) {
        throw new Error(
            `Missing prompt bundle manifest: ${path}. Run "bun run install:templates" or copy templates/prompts.`,
        );
    }
    const text = await file.text();
    const parsed = JSON.parse(text) as Partial<PromptTemplateBundleManifest>;
    if (typeof parsed.schemaVersion !== "number" || !Number.isFinite(parsed.schemaVersion)) {
        throw new Error(`Invalid prompt bundle manifest: ${path}`);
    }
    if (!Array.isArray(parsed.templates) && parsed.schemaVersion !== PROMPT_TEMPLATE_BUNDLE_VERSION) {
        return { schemaVersion: parsed.schemaVersion, templates: [] };
    }
    if (!Array.isArray(parsed.templates)) {
        throw new Error(`Invalid prompt bundle manifest templates: ${path}`);
    }
    return { schemaVersion: parsed.schemaVersion, templates: parsed.templates };
}

function diffPromptTemplateManifest(actual: PromptTemplateBundleManifest): string | undefined {
    const expected = PROMPT_TEMPLATE_BUNDLE_MANIFEST;
    if (actual.templates.length !== expected.templates.length) {
        return `manifest templates length ${actual.templates.length} does not match runtime ${expected.templates.length}`;
    }
    for (let index = 0; index < expected.templates.length; index += 1) {
        const expectedEntry = expected.templates[index];
        const actualEntry = actual.templates[index];
        if (!expectedEntry) {
            return `runtime manifest template entry ${index} is missing`;
        }
        if (!actualEntry) {
            return `manifest template entry ${index} is missing`;
        }
        if (
            actualEntry.key !== expectedEntry.key ||
            actualEntry.filename !== expectedEntry.filename ||
            !sameStringArray(actualEntry.requiredPlaceholders, expectedEntry.requiredPlaceholders)
        ) {
            return `manifest template entry ${index} does not match runtime definition for ${expectedEntry.key}`;
        }
    }
    return undefined;
}

function sameStringArray(left: readonly string[] | undefined, right: readonly string[]): boolean {
    if (!left || left.length !== right.length) {
        return false;
    }
    return left.every((item, index) => item === right[index]);
}


function promptJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
