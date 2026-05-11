import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";
import type { BlackboardDiscussionPlan } from "../../protocol/contracts/index.ts";
import type { BlackboardMode } from "../../protocol/contracts/index.ts";

export interface RuntimeSystemPromptInput {
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
    markdown: string;
    renderedResults: string;
    renderedSessionMessages: string;
}

export interface CrystalReflectionPromptInput {
    evidence: string;
}

export interface BlackboardDecisionPromptInput {
    reason: string;
    unresolvedIssues: string[];
}

interface PromptTemplate {
    content: string;
    filename: string;
}

type PromptTemplateKey =
    | "blackboardAdvisory"
    | "blackboardDecision"
    | "blackboardRoute"
    | "blackboardWorkerSystem"
    | "crystalReflection"
    | "memoryAction"
    | "memoryContext"
    | "mcpContext"
    | "runtimeSystem"
    | "skillContext";

type PromptTemplateMap = Record<PromptTemplateKey, PromptTemplate>;

const PROMPT_TEMPLATE_FILES: Record<PromptTemplateKey, string> = {
    blackboardAdvisory: "blackboard.advisory.md",
    blackboardDecision: "blackboard.decision.md",
    blackboardRoute: "blackboard.route.md",
    blackboardWorkerSystem: "blackboard.worker.system.md",
    crystalReflection: "crystal.reflection.md",
    memoryAction: "memory.action.md",
    memoryContext: "memory.context.md",
    mcpContext: "mcp.context.md",
    runtimeSystem: "runtime.system.md",
    skillContext: "skill.context.md",
};

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
    const loaded = {} as PromptTemplateMap;
    for (const key of Object.keys(PROMPT_TEMPLATE_FILES) as PromptTemplateKey[]) {
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
    for (const key of Object.keys(PROMPT_TEMPLATE_FILES) as PromptTemplateKey[]) {
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

export function renderSkillContextPrompt(input: SkillContextPromptInput): string {
    // 必要提示词：Skill Markdown 是用户/项目提供的能力说明；这里只做上下文格式化，不控制运行时收敛。
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
        mcpEntries: enabled
            .map((server) => {
                const target = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
                return `- ${server.name}: ${target}`;
            })
            .join("\n"),
    });
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

export function renderBlackboardWorkerEnvelope(input: BlackboardWorkerEnvelopeInput): string {
    // 必要提示词：外部 worker/进程只收到英文 JSON 协议信封；调度和收敛只读取结构化 result 字段。
    return JSON.stringify(
        {
            protocol: "flyflor.blackboard.worker.v1",
            goal: input.goal,
            round: input.round,
            minRounds: input.minRounds,
            phase: input.phase,
            participant: input.participant,
            contract: input.contract,
            discussionPlan: input.discussionPlan,
            convergencePolicy: input.convergencePolicy,
            currentRoundSteps: input.currentRoundSteps,
            previousSteps: input.previousSteps,
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
        null,
        2,
    );
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
        markdownContent: input.markdown,
        retrievedResults: input.renderedResults,
        sessionMessages: input.renderedSessionMessages,
    });
}

export function renderCrystalReflectionPrompt(input: CrystalReflectionPromptInput): string {
    // 必要提示词：反思 worker 只收到最小英文抽取要求；桶、符号和坐标必须从证据中生成，代码不提供固定分类。
    return renderTemplate(requiredTemplates().crystalReflection.content, {
        evidence: input.evidence,
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
