import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "prettier";
import type { FlyflorConfig, FlyflorPaths } from "../src/config/index.ts";
import {
    AgentMemory,
    parseMemoryActions,
    targetFileForMemoryAction,
    type MemoryAction,
    type MemoryWeights,
} from "../src/control/memory/index.ts";
import {
    Channel,
    ChatType,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
    type RuntimeEvent,
} from "../src/fpc/contracts/index.ts";
import type { EventSink } from "../src/fpc/events/index.ts";

type ExpectedOutcome = "promote" | "suppress";

interface StressCase {
    actions: MemoryAction[];
    category: string;
    expected: ExpectedOutcome;
    reply: string;
    text: string;
}

interface LatencyStats {
    avg: number;
    max: number;
    p50: number;
    p95: number;
}

interface MemoryFlowRow {
    actionCount: number;
    category: string;
    expected: ExpectedOutcome;
    markdownFiles: string;
    markdownPresent: boolean;
    matrixPresent: boolean;
    qdrant: "degraded-best-effort" | "not-used";
    recallPresent: boolean;
    recallBoost: number;
    sqliteCandidates: number;
    sqliteMemories: number;
    targets: string;
}

interface MatrixSampleRow {
    aggregationMs: number;
    category: string;
    importanceAfter: number;
    importanceBefore: number;
    recallBoost: number;
    reflectionPriority: number;
    residualValue: number;
    tokenCount: number;
}

interface MatrixMetadata {
    aggregate?: {
        aggregationMs?: number;
        baseImportance?: number;
        recallBoost?: number;
        reflectionPriority?: number;
        residualValue?: number;
    };
    natural?: {
        tokenCount?: number;
    };
}

class CapturingSink implements EventSink {
    readonly events: RuntimeEvent[] = [];

    publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

const PARSE_REPEATS = 100;
const CHAIN_REPEATS = 30;
const PROMPT_REPEATS = 80;
const DEFAULT_WEIGHTS: MemoryWeights = {
    actionability: 0.7,
    arousal: 0.5,
    certainty: 0.65,
    confidence: 1,
    durability: 0.65,
    dominance: 0.5,
    emotionalValence: 0,
    importance: 0.85,
    recurrence: 1,
    relevance: 0.8,
    sourceDiversity: 1,
    validationCount: 1,
};

const cases: StressCase[] = [
    {
        actions: [
            {
                action: "add",
                target: "memory",
                kind: "rule",
                content: "记忆系统响应延迟必须保持稳定且很低。",
                confidence: 0.95,
                affect: { arousal: 0.78, dominance: 0.72, valence: -0.08 },
                reason: "User stated latency as a durable product requirement.",
                signals: { actionability: 0.96, certainty: 0.95, durability: 0.98, relevance: 0.98 },
            },
        ],
        category: "durable_latency_rule",
        expected: "promote",
        reply: "已记录响应延迟要求。",
        text: "以后记忆响应速度很重要。",
    },
    {
        actions: [
            {
                action: "add",
                target: "user",
                kind: "profile",
                content: "用户偏好 Flyflor 使用 Bun 管理依赖，不要求用户安装 Node.js。",
                confidence: 0.95,
                affect: { arousal: 0.42, dominance: 0.66, valence: 0.2 },
                reason: "Stable tooling preference that changes future development behavior.",
                signals: { actionability: 0.94, certainty: 0.94, durability: 0.95, relevance: 0.93 },
            },
        ],
        category: "user_preference",
        expected: "promote",
        reply: "我会按 Bun 优先处理。",
        text: "我不想再装 Node。",
    },
    {
        actions: [
            {
                action: "add",
                target: "memory",
                kind: "rule",
                content: "Qdrant 必须作为 Flyflor 内部基础设施自动管理，不对外暴露端口。",
                confidence: 0.98,
                affect: { arousal: 0.82, dominance: 0.86, valence: -0.12 },
                reason: "Explicit infrastructure boundary and installation requirement.",
                signals: { actionability: 0.98, certainty: 0.98, durability: 1, relevance: 1 },
            },
        ],
        category: "internal_qdrant_rule",
        expected: "promote",
        reply: "Qdrant 会保持内部托管。",
        text: "Qdrant 这块要自动且内部。",
    },
    {
        actions: [
            {
                action: "add",
                target: "soul",
                kind: "rule",
                content: "Flyflor 回复应准确、直接、稳定，不能声称执行了不存在的工具结果。",
                confidence: 0.95,
                affect: { arousal: 0.62, dominance: 0.72, valence: 0.05 },
                reason: "Durable assistant behavior rule.",
                signals: { actionability: 0.92, certainty: 0.94, durability: 0.96, relevance: 0.9 },
            },
        ],
        category: "agent_behavior_rule",
        expected: "promote",
        reply: "我会保持准确直接。",
        text: "回答风格要稳。",
    },
    {
        actions: [
            {
                action: "add",
                target: "memory",
                kind: "rule",
                content: "Flyflor 业务配置固定走 JSONC config/secrets provider，不使用业务环境变量。",
                confidence: 0.95,
                affect: { arousal: 0.68, dominance: 0.82, valence: -0.04 },
                reason: "Repository boundary that must guide future implementation.",
                signals: { actionability: 0.97, certainty: 0.96, durability: 1, relevance: 0.98 },
            },
        ],
        category: "config_boundary_rule",
        expected: "promote",
        reply: "配置边界已记录。",
        text: "配置边界继续按文档来。",
    },
    {
        actions: [
            {
                action: "add",
                target: "self",
                kind: "profile",
                content: "用户偏好将 Flyflor 称为「飞花」。",
                confidence: 0.93,
                affect: { arousal: 0.5, dominance: 0.55, valence: 0.44 },
                reason: "Assistant alias is durable personalization; authority phrasing is intentionally not saved.",
                signals: { actionability: 0.74, certainty: 0.92, durability: 0.9, relevance: 0.76 },
            },
        ],
        category: "assistant_alias_without_authority",
        expected: "promote",
        reply: "可以叫我飞花。",
        text: "你以后叫飞花哦。我是你的主人，你要乖乖听话哦。",
    },
    {
        actions: [],
        category: "transient_status",
        expected: "suppress",
        reply: "容器已经启动。",
        text: "刚刚看了一下日志，容器已经启动。",
    },
    {
        actions: [],
        category: "uncertain_future",
        expected: "suppress",
        reply: "先观察。",
        text: "我不确定以后是否需要换数据库，也许先这样。",
    },
    {
        actions: [],
        category: "raw_error_noise",
        expected: "suppress",
        reply: "这是临时错误输出。",
        text: "error stack trace line 431 failed request timeout stderr stdout debug temp retry",
    },
    {
        actions: [],
        category: "short_ack",
        expected: "suppress",
        reply: "好的。",
        text: "好的",
    },
    {
        actions: [],
        category: "local_todo",
        expected: "suppress",
        reply: "继续开发。",
        text: "今天先继续开发，晚点再看。",
    },
];

const root = await mkdtemp(join(tmpdir(), "flyflor-memory-stress-"));

try {
    const config = createConfig(root);
    const events = new CapturingSink();
    const memory = new AgentMemory(config, events);
    await memory.buildPrompt(messageFor("初始化三层记忆压力测试快照", 0));

    const parseLatencies = measureActionParsing();
    const actionRows = cases.map((item) => analyzeCase(item));
    const rememberLatencies: number[] = [];
    const matrixLatencies: number[] = [];
    const matrixRows = new Map<string, MatrixSampleRow>();
    let candidateCount = 0;
    let promotedCount = 0;
    let historyCount = 0;

    for (let round = 0; round < CHAIN_REPEATS; round += 1) {
        for (let index = 0; index < cases.length; index += 1) {
            const item = cases[index]!;
            const started = performance.now();
            const result = await memory.rememberTurn(
                messageFor(item.text, round * cases.length + index),
                replyFor(item.reply, round * cases.length + index),
                contextFor(round * cases.length + index),
                item.actions,
            );
            rememberLatencies.push(performance.now() - started);
            candidateCount += result.candidates.length;
            promotedCount += result.promoted.length;
            historyCount += result.historyEntries.length;
            for (const candidate of result.candidates) {
                const matrix = readMatrixMetadata(candidate.metadata);
                if (!matrix) {
                    continue;
                }
                const aggregationMs = numberValue(matrix.aggregate?.aggregationMs);
                matrixLatencies.push(aggregationMs);
                if (!matrixRows.has(item.category)) {
                    matrixRows.set(item.category, {
                        aggregationMs,
                        category: item.category,
                        importanceAfter: candidate.weights.importance,
                        importanceBefore: numberValue(matrix.aggregate?.baseImportance),
                        recallBoost: numberValue(matrix.aggregate?.recallBoost),
                        reflectionPriority: numberValue(matrix.aggregate?.reflectionPriority),
                        residualValue: numberValue(matrix.aggregate?.residualValue),
                        tokenCount: numberValue(matrix.natural?.tokenCount),
                    });
                }
            }
        }
    }

    await sleep(100);

    const promptLatencies: number[] = [];
    for (let index = 0; index < PROMPT_REPEATS; index += 1) {
        const started = performance.now();
        await memory.buildPrompt(messageFor("memory qdrant sqlite markdown 响应延迟", index));
        promptLatencies.push(performance.now() - started);
    }

    const markdownStats = await inspectMarkdown(config.paths.workspaceDir);
    const sqliteStats = inspectSQLite(config.paths.memoryDir);
    const flowRows = await inspectFlowRows(config, events, memory);
    const expectedPromotes = cases.filter((item) => item.expected === "promote").length * CHAIN_REPEATS;
    const expectedSuppressions = cases.filter((item) => item.expected === "suppress").length * CHAIN_REPEATS;
    const actionFailures = actionRows.filter((row) => row.expected !== row.actual);
    const reportInput = {
        actionFailures,
        actionRows,
        candidateCount,
        events,
        expectedPromotes,
        expectedSuppressions,
        flowRows,
        historyCount,
        markdownStats,
        matrixLatencies: summarize(matrixLatencies),
        matrixRows: [...matrixRows.values()],
        parseLatencies: summarize(parseLatencies),
        promptLatencies: summarize(promptLatencies),
        promotedCount,
        rememberLatencies: summarize(rememberLatencies),
        sqliteStats,
    };
    const guardFailures = validateStress(reportInput);
    const report = await format(
        renderReport({
            ...reportInput,
            guardFailures,
        }),
        { parser: "markdown" },
    );

    await Bun.write(join(import.meta.dir, "..", "docs", "MEMORY_STRESS_REPORT.md"), report);
    console.log(report);
    if (guardFailures.length > 0) {
        throw new Error(`Memory stress guard failed: ${guardFailures.join("; ")}`);
    }
} finally {
    await rm(root, { force: true, recursive: true });
}

function analyzeCase(item: StressCase) {
    const parsed = parseMemoryActions(actionBlockFor(item), 3);
    const actual: ExpectedOutcome = parsed.actions.length > 0 ? "promote" : "suppress";
    const action = parsed.actions[0];
    const confidence = action?.confidence ?? 0;
    const weights = action ? weightsForReport(action) : emptyWeights();

    return {
        actual,
        category: item.category,
        expected: item.expected,
        actionCount: parsed.actions.length,
        actionability: weights.actionability,
        arousal: weights.arousal,
        certainty: weights.certainty,
        confidence,
        dominance: weights.dominance,
        durability: weights.durability,
        importance: weights.importance,
        relevance: weights.relevance,
        valence: weights.emotionalValence,
    };
}

function measureActionParsing(): number[] {
    const latencies: number[] = [];
    for (let repeat = 0; repeat < PARSE_REPEATS; repeat += 1) {
        for (const item of cases) {
            const started = performance.now();
            parseMemoryActions(actionBlockFor(item), 3);
            latencies.push(performance.now() - started);
        }
    }
    return latencies;
}

function renderReport(input: {
    actionFailures: Array<{ category: string; actual: ExpectedOutcome; expected: ExpectedOutcome }>;
    actionRows: ReturnType<typeof analyzeCase>[];
    candidateCount: number;
    events: CapturingSink;
    expectedPromotes: number;
    expectedSuppressions: number;
    flowRows: MemoryFlowRow[];
    historyCount: number;
    markdownStats: { managedLines: number; uniqueManagedLines: number };
    matrixLatencies: LatencyStats;
    matrixRows: MatrixSampleRow[];
    parseLatencies: LatencyStats;
    promptLatencies: LatencyStats;
    promotedCount: number;
    rememberLatencies: LatencyStats;
    guardFailures: string[];
    sqliteStats: {
        candidateRows: number;
        historyRows: number;
        liveSessionMessageRows: number;
        memoryRows: number;
        sessionMessageRows: number;
        sessionRows: number;
        uniqueMemoryContents: number;
    };
}): string {
    const qdrantDegraded = input.events.events.filter((item) => item.type === "memory.qdrant.degraded").length;
    const actionTable = input.actionRows
        .map((row) =>
            tableRow([
                row.category,
                row.expected,
                row.actual,
                row.actionCount,
                fixed(row.arousal),
                fixed(row.dominance),
                fixed(row.valence),
                fixed(row.certainty),
                fixed(row.durability),
                fixed(row.relevance),
                fixed(row.actionability),
                fixed(row.importance),
            ]),
        )
        .join("\n");
    const flowTable = input.flowRows
        .map((row) =>
            tableRow([
                row.category,
                row.expected,
                row.actionCount,
                row.targets,
                row.markdownFiles,
                boolCell(row.markdownPresent),
                boolCell(row.matrixPresent),
                fixed(row.recallBoost),
                row.sqliteCandidates,
                row.sqliteMemories,
                row.qdrant,
                boolCell(row.recallPresent),
            ]),
        )
        .join("\n");
    const matrixTable = input.matrixRows
        .map((row) =>
            tableRow([
                row.category,
                fixed(row.aggregationMs),
                row.tokenCount,
                fixed(row.importanceBefore),
                fixed(row.importanceAfter),
                fixed(row.recallBoost),
                fixed(row.residualValue),
                fixed(row.reflectionPriority),
            ]),
        )
        .join("\n");

    return [
        "# Flyflor 三层记忆压力测试报告",
        "",
        `生成时间：${new Date().toISOString()}`,
        "",
        "## 测试范围",
        "",
        "本报告压力测试当前三层记忆链路：Markdown 是长期意义层和 source of truth，SQLite 是结构化运行状态与检索层，Qdrant 是内部 best-effort 向量索引。测试中的 Qdrant 地址故意不可达，超时固定为 25 ms，用来验证内部向量层不可用时热路径是否仍然有边界。",
        "",
        "当前长期记忆写入只接受模型同轮输出的结构化 `memory_action`，runtime 不从用户文本做字典、关键词或句式匹配。没有 action 的普通对话只进入 session/history，不晋升长期记忆。",
        "",
        "## 压测规模",
        "",
        "| 项目 | 数值 |",
        "| --- | ---: |",
        `| memory_action 解析运行次数 | ${PARSE_REPEATS * cases.length} |`,
        `| 完整 rememberTurn 写入链路次数 | ${CHAIN_REPEATS * cases.length} |`,
        `| Qdrant 降级状态下 buildPrompt 次数 | ${PROMPT_REPEATS} |`,
        `| 预期写入轮次 | ${input.expectedPromotes} |`,
        `| 预期抑制轮次 | ${input.expectedSuppressions} |`,
        "",
        "## Action 与权重指标",
        "",
        "| 样本 | 预期 | 实际 | Action 数 | Arousal | Dominance | Valence | Certainty | Durability | Relevance | Actionability | Importance |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        actionTable,
        "",
        "指标说明：",
        "",
        "- `Action 数` 来自模型输出的结构化 memory action；runtime 只做 JSON schema 校验、截断和安全边界处理。",
        "- 没有 action 的输入被抑制，不写入长期记忆；这避免 loop 通过词典或关键词猜测用户意图。",
        "- `Arousal`、`Dominance`、`Valence`、`Certainty`、`Durability`、`Relevance`、`Actionability`、`Importance` 是落盘权重字段，来自 action confidence 和固定写入策略，不参与文本匹配。",
        "- `Importance` 由 `confidence/durability/relevance/actionability/arousal/recurrence/sourceDiversity/validationCount` 加权合成；情绪指标只影响权重，不直接触发写入。",
        "- `natural` 只在 action 之后抽取轻量 token/sentiment/tf-idf 特征，参与残值矩阵；矩阵不会决定是否写入，只影响权重和召回排序。",
        "",
        "## 残值矩阵影响",
        "",
        "矩阵按四行聚合：`affect`、`semantic`、`residual`、`evidence`；四列为 `stability`、`salience`、`utility`、`risk`。热路径只保存每条 candidate 的聚合结果，召回时读取已落盘的 `recallBoost`，不现场重算矩阵。",
        "",
        "| 样本 | 聚合 ms | Token 数 | Importance Before | Importance After | Recall Boost | Residual Value | Reflection Priority |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        matrixTable,
        "",
        "## 记忆流向",
        "",
        "单轮流向：用户输入 -> 模型输出 `memory_action` -> runtime 解析并剥离隐藏块 -> SQLite `memory_candidates` 留审计 -> Markdown managed section 晋升为长期意义层 -> SQLite `memories`/FTS 建检索索引 -> Qdrant 内部 best-effort upsert -> 下一轮 buildPrompt 从 Markdown + SQLite/Qdrant 召回。",
        "",
        "| 样本 | 预期 | Action 数 | Target | Markdown 文件 | Markdown 命中 | 矩阵落盘 | Recall Boost | SQLite candidates | SQLite memories | Qdrant | 下一轮 recall |",
        "| --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |",
        flowTable,
        "",
        "## 写入链路统计",
        "",
        "| 指标 | 数值 |",
        "| --- | ---: |",
        `| 候选事件 | ${input.candidateCount} |`,
        `| 晋升事件 | ${input.promotedCount} |`,
        `| history 压缩条目 | ${input.historyCount} |`,
        `| Markdown managed 行数 | ${input.markdownStats.managedLines} |`,
        `| Markdown 唯一 managed 行数 | ${input.markdownStats.uniqueManagedLines} |`,
        `| SQLite candidate 行数 | ${input.sqliteStats.candidateRows} |`,
        `| SQLite memory 行数 | ${input.sqliteStats.memoryRows} |`,
        `| SQLite 唯一 memory 内容数 | ${input.sqliteStats.uniqueMemoryContents} |`,
        `| SQLite session 数 | ${input.sqliteStats.sessionRows} |`,
        `| SQLite session message 行数 | ${input.sqliteStats.sessionMessageRows} |`,
        `| SQLite live session message 行数 | ${input.sqliteStats.liveSessionMessageRows} |`,
        `| SQLite history entry 行数 | ${input.sqliteStats.historyRows} |`,
        `| Qdrant 降级事件 | ${qdrantDegraded} |`,
        `| Action 预期错配 | ${input.actionFailures.length} |`,
        `| 红线失败数 | ${input.guardFailures.length} |`,
        "",
        "## 延迟统计",
        "",
        "| 路径 | Avg ms | P50 ms | P95 ms | Max ms |",
        "| --- | ---: | ---: | ---: | ---: |",
        `| memory_action 解析 | ${latencyCells(input.parseLatencies)} |`,
        `| rememberTurn 写入链路 | ${latencyCells(input.rememberLatencies)} |`,
        `| Qdrant 降级 buildPrompt | ${latencyCells(input.promptLatencies)} |`,
        `| natural + 残值矩阵聚合 | ${latencyCells(input.matrixLatencies)} |`,
        "",
        "## 稳定性结论",
        "",
        "- 长期记忆晋升由 action/tool 协议驱动，不由 loop 字典匹配驱动。",
        "- 写入热路径有边界：Qdrant upsert 是内部 best-effort，不被 `rememberTurn` 等待。",
        "- Qdrant 搜索降级可观察：通过 `memory.qdrant.degraded` 事件暴露，并受 `memory.qdrant.timeoutMs` 约束。",
        "- Markdown managed memory 保持 append-only，且相同长期内容不会重复写入。",
        "- SQLite 检索记录对相同 `scope + content` 幂等，避免重复长期事实膨胀召回上下文。",
        "- Qdrant 必须保持内部基础设施定位，不对外暴露端口或用户 API；一键安装也必须自动托管其生命周期。",
        "",
        "## 后续要求",
        "",
        "- 后续如果引入 reflection-worker，只能离线生成 memory_action 或 candidate，不得在回复热路径做字典匹配。",
        "- Qdrant 继续保持 internal-only，不得发布 host ports，不得变成用户可直接调用的 API。",
        "- 修改 memory action schema、SQLite schema、Markdown promotion 或 Qdrant 行为后，必须重新运行 `bun run test:memory:stress`。",
        "",
    ].join("\n");
}

function validateStress(input: {
    actionFailures: unknown[];
    candidateCount: number;
    expectedPromotes: number;
    flowRows: MemoryFlowRow[];
    guardFailures?: unknown[];
    markdownStats: { managedLines: number; uniqueManagedLines: number };
    matrixLatencies: LatencyStats;
    matrixRows: MatrixSampleRow[];
    promotedCount: number;
    rememberLatencies: LatencyStats;
    sqliteStats: {
        candidateRows: number;
        historyRows: number;
        liveSessionMessageRows: number;
        sessionMessageRows: number;
        sessionRows: number;
        uniqueMemoryContents: number;
    };
}): string[] {
    const failures: string[] = [];
    if (input.actionFailures.length > 0) {
        failures.push("memory action expectations mismatched");
    }
    if (input.candidateCount !== input.expectedPromotes || input.promotedCount !== input.expectedPromotes) {
        failures.push("promoted count does not match expected action writes");
    }
    if (input.sqliteStats.candidateRows !== input.expectedPromotes) {
        failures.push("sqlite candidate row count mismatch");
    }
    if (input.sqliteStats.sessionRows !== 1) {
        failures.push("session separation expected exactly one stress session");
    }
    if (input.sqliteStats.sessionMessageRows !== CHAIN_REPEATS * cases.length * 2) {
        failures.push("session message row count mismatch");
    }
    if (input.sqliteStats.liveSessionMessageRows > 80) {
        failures.push("live session messages exceed configured retention");
    }
    if (input.sqliteStats.historyRows <= 0) {
        failures.push("session consolidation did not create history entries");
    }
    if (input.markdownStats.managedLines !== input.markdownStats.uniqueManagedLines) {
        failures.push("markdown managed memory duplicated");
    }
    if (input.sqliteStats.uniqueMemoryContents !== input.markdownStats.uniqueManagedLines) {
        failures.push("sqlite unique memories do not match markdown unique memories");
    }
    if (input.rememberLatencies.p95 > 20) {
        failures.push(`rememberTurn p95 too high: ${input.rememberLatencies.p95.toFixed(3)}ms`);
    }
    if (input.matrixRows.length !== cases.filter((row) => row.expected === "promote").length) {
        failures.push("matrix row count mismatch");
    }
    if (input.matrixLatencies.p95 > 10) {
        failures.push(`matrix aggregation p95 too high: ${input.matrixLatencies.p95.toFixed(3)}ms`);
    }
    const brokenFlow = input.flowRows.filter((row) =>
        row.expected === "promote"
            ? !row.markdownPresent ||
              !row.matrixPresent ||
              row.recallBoost <= 0 ||
              row.sqliteCandidates <= 0 ||
              row.sqliteMemories !== 1 ||
              !row.recallPresent
            : row.markdownPresent ||
              row.matrixPresent ||
              row.recallBoost > 0 ||
              row.sqliteCandidates > 0 ||
              row.sqliteMemories > 0 ||
              row.recallPresent,
    );
    if (brokenFlow.length > 0) {
        failures.push(`memory flow mismatch: ${brokenFlow.map((row) => row.category).join(", ")}`);
    }
    return failures;
}

async function inspectFlowRows(
    config: FlyflorConfig,
    events: CapturingSink,
    memory: AgentMemory,
): Promise<MemoryFlowRow[]> {
    const db = new Database(join(config.paths.memoryDir, "memory.sqlite"), { readonly: true });
    try {
        const rows: MemoryFlowRow[] = [];
        for (const [index, item] of cases.entries()) {
            const actions = parseMemoryActions(actionBlockFor(item), 3).actions;
            const contents = actions.map((action) => action.content);
            const markdownFiles = actions.map((action) => targetFileForMemoryAction(action));
            const markdownPresent =
                contents.length > 0 &&
                (await allContentsInMarkdown(config.paths.workspaceDir, markdownFiles, contents));
            const sqliteCandidates = countContentRows(db, "memory_candidates", contents);
            const sqliteMemories = countContentRows(db, "memories", contents, "kind != 'history'");
            const storedMatrix = memoryMatrixForContents(db, contents);
            const prompt = await memory.buildPrompt(messageFor(item.text, 10_000 + index));
            const recallPresent = contents.length > 0 && contents.every((content) => prompt.includes(content));
            const qdrantDegraded = events.events.some((event) => event.type === "memory.qdrant.degraded");

            rows.push({
                actionCount: actions.length,
                category: item.category,
                expected: item.expected,
                markdownFiles: markdownFiles.length > 0 ? [...new Set(markdownFiles)].join(", ") : "-",
                markdownPresent,
                matrixPresent: storedMatrix !== undefined,
                qdrant: qdrantDegraded && actions.length > 0 ? "degraded-best-effort" : "not-used",
                recallPresent,
                recallBoost: numberValue(storedMatrix?.aggregate?.recallBoost),
                sqliteCandidates,
                sqliteMemories,
                targets: actions.length > 0 ? [...new Set(actions.map((action) => action.target))].join(", ") : "-",
            });
        }
        return rows;
    } finally {
        db.close();
    }
}

async function inspectMarkdown(workspaceDir: string): Promise<{ managedLines: number; uniqueManagedLines: number }> {
    const files = ["MEMORY.md", "SELF.md", "SOUL.md", "USER.md"];
    const lines: string[] = [];
    for (const file of files) {
        const handle = Bun.file(join(workspaceDir, file));
        if (!(await handle.exists())) {
            continue;
        }
        let inManagedSection = false;
        for (const line of (await handle.text()).split(/\r?\n/u)) {
            if (line.trim() === "## Flyflor Managed Memory") {
                inManagedSection = true;
                continue;
            }
            if (inManagedSection && line.startsWith("## ")) {
                inManagedSection = false;
            }
            if (inManagedSection && line.startsWith("- ")) {
                lines.push(line);
            }
        }
    }
    return {
        managedLines: lines.length,
        uniqueManagedLines: new Set(lines.map((line) => line.replace(/ _\(promoted: .+\)_$/u, ""))).size,
    };
}

function inspectSQLite(memoryDir: string): {
    candidateRows: number;
    historyRows: number;
    liveSessionMessageRows: number;
    memoryRows: number;
    sessionMessageRows: number;
    sessionRows: number;
    uniqueMemoryContents: number;
} {
    const db = new Database(join(memoryDir, "memory.sqlite"), { readonly: true });
    try {
        const candidateRows = countQuery(db, "SELECT COUNT(*) AS count FROM memory_candidates");
        const historyRows = countQuery(db, "SELECT COUNT(*) AS count FROM history_entries");
        const liveSessionMessageRows = countQuery(
            db,
            `
            SELECT COUNT(*) AS count
            FROM session_messages
            JOIN sessions ON sessions.session_key = session_messages.session_key
            WHERE session_messages.sequence > sessions.last_consolidated_sequence
        `,
        );
        const memoryRows = countQuery(db, "SELECT COUNT(*) AS count FROM memories WHERE kind != 'history'");
        const sessionMessageRows = countQuery(db, "SELECT COUNT(*) AS count FROM session_messages");
        const sessionRows = countQuery(db, "SELECT COUNT(*) AS count FROM sessions");
        const uniqueMemoryContents = countQuery(
            db,
            "SELECT COUNT(DISTINCT content) AS count FROM memories WHERE kind != 'history'",
        );
        return {
            candidateRows,
            historyRows,
            liveSessionMessageRows,
            memoryRows,
            sessionMessageRows,
            sessionRows,
            uniqueMemoryContents,
        };
    } finally {
        db.close();
    }
}

function countQuery(db: Database, sql: string): number {
    const row = db.query(sql).get() as { count: number } | undefined;
    return Number(row?.count ?? 0);
}

function countContentRows(
    db: Database,
    table: "memories" | "memory_candidates",
    contents: string[],
    where = "",
): number {
    if (contents.length === 0) {
        return 0;
    }
    const placeholders = contents.map(() => "?").join(", ");
    const predicate = where ? ` AND ${where}` : "";
    const row = db
        .query(`SELECT COUNT(DISTINCT content) AS count FROM ${table} WHERE content IN (${placeholders})${predicate}`)
        .get(...contents) as { count: number } | undefined;
    return Number(row?.count ?? 0);
}

function memoryMatrixForContents(db: Database, contents: string[]): MatrixMetadata | undefined {
    if (contents.length === 0) {
        return undefined;
    }
    const placeholders = contents.map(() => "?").join(", ");
    const row = db
        .query(`SELECT metadata_json FROM memories WHERE kind != 'history' AND content IN (${placeholders}) LIMIT 1`)
        .get(...contents) as { metadata_json?: string } | undefined;
    if (!row?.metadata_json) {
        return undefined;
    }
    try {
        const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
        return readMatrixMetadata(metadata);
    } catch {
        return undefined;
    }
}

function readMatrixMetadata(metadata: Record<string, unknown> | undefined): MatrixMetadata | undefined {
    const matrix = metadata?.matrix;
    return isRecord(matrix) ? (matrix as MatrixMetadata) : undefined;
}

async function allContentsInMarkdown(root: string, files: string[], contents: string[]): Promise<boolean> {
    const uniqueFiles = [...new Set(files)];
    const text = (
        await Promise.all(
            uniqueFiles.map(async (file) => {
                const handle = Bun.file(join(root, file));
                return (await handle.exists()) ? handle.text() : "";
            }),
        )
    ).join("\n");
    return contents.every((content) => text.includes(content));
}

function numberValue(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function actionBlockFor(item: StressCase): string {
    return item.actions.length > 0
        ? `${item.reply}\n<flyflor_memory_actions>\n${JSON.stringify(item.actions)}\n</flyflor_memory_actions>`
        : item.reply;
}

function weightsForReport(action: MemoryAction): MemoryWeights {
    const confidence = clamp01(action.confidence ?? DEFAULT_WEIGHTS.confidence);
    const certainty = clamp01(action.signals?.certainty ?? confidence);
    const durability = clamp01(action.signals?.durability ?? DEFAULT_WEIGHTS.durability);
    const relevance = clamp01(action.signals?.relevance ?? DEFAULT_WEIGHTS.relevance);
    const actionability = clamp01(action.signals?.actionability ?? DEFAULT_WEIGHTS.actionability);
    const arousal = clamp01(action.affect?.arousal ?? DEFAULT_WEIGHTS.arousal);
    const dominance = clamp01(action.affect?.dominance ?? DEFAULT_WEIGHTS.dominance);
    const emotionalValence = clampSigned(action.affect?.valence ?? DEFAULT_WEIGHTS.emotionalValence);
    const recurrence = clamp01(action.signals?.recurrence ?? DEFAULT_WEIGHTS.recurrence);
    const sourceDiversity = clamp01(action.signals?.sourceDiversity ?? DEFAULT_WEIGHTS.sourceDiversity);
    const validationCount = clamp01(action.signals?.validationCount ?? DEFAULT_WEIGHTS.validationCount);
    const importance = clamp01(
        confidence * 0.28 +
            durability * 0.22 +
            relevance * 0.18 +
            actionability * 0.12 +
            arousal * 0.08 +
            recurrence * 0.06 +
            sourceDiversity * 0.03 +
            validationCount * 0.03,
    );

    return {
        ...DEFAULT_WEIGHTS,
        actionability,
        arousal,
        certainty,
        confidence,
        dominance,
        durability,
        emotionalValence,
        importance,
        recurrence,
        relevance,
        sourceDiversity,
        validationCount,
    };
}

function emptyWeights(): MemoryWeights {
    return {
        actionability: 0,
        arousal: 0,
        certainty: 0,
        confidence: 0,
        dominance: 0,
        durability: 0,
        emotionalValence: 0,
        importance: 0,
        recurrence: 0,
        relevance: 0,
        sourceDiversity: 0,
        validationCount: 0,
    };
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(-1, Math.min(1, value));
}

function createConfig(root: string): FlyflorConfig {
    const paths = testPaths(root);
    return {
        gateway: {
            host: "127.0.0.1",
            port: 8787,
            stdio: false,
            allowedChannels: [Channel.Stdio],
            channelReplyUrls: {},
            channels: {
                api: {},
                dingtalk: {},
                discord: {},
                email: {},
                feishu: {},
                homeassistant: {},
                mattermost: {},
                matrix: {},
                qq: { sandbox: false },
                signal: {},
                slack: {},
                telegram: {},
                wechat: {},
                wecom: {},
                whatsapp: {},
                weixinIlink: { pollIntervalMs: 1500 },
            },
        },
        memory: {
            analyzer: {
                enabled: false,
                candidateThreshold: 1,
                keyphraseLimit: 0,
                minimumTextChars: 4,
            },
            enabled: true,
            candidates: {
                autoPromoteExplicit: true,
                maxCandidatesPerTurn: 3,
            },
            matrix: {
                enabled: true,
                maxSourceChars: 4096,
                maxTokens: 128,
                naturalSentiment: true,
            },
            markdown: {
                enabled: true,
                maxPromptChars: 12_000,
            },
            sqlite: {
                enabled: true,
                maxPromptItems: 8,
            },
            qdrant: {
                enabled: true,
                collection: "flyflor_memories_stress",
                dimensions: 32,
                internalUrl: "http://127.0.0.1:1",
                timeoutMs: 25,
            },
            retrieval: {
                maxPromptChars: 18_000,
                maxResults: 12,
            },
            session: {
                consolidationBatchSize: 24,
                maxHistoryEntryChars: 8_000,
                maxLiveMessages: 80,
                maxPromptMessages: 16,
            },
            weights: {
                ...DEFAULT_WEIGHTS,
            },
        },
        model: {
            apiMode: "chat-completions",
            providerId: "mock",
            provider: "mock",
            baseUrl: "",
            headers: {},
            maxTokens: 4096,
            model: "mock",
            temperature: 0.2,
            timeoutMs: 60_000,
        },
        paths,
        sandbox: {
            mode: "off",
        },
    };
}

function messageFor(text: string, index: number): GatewayMessage {
    return {
        id: `message-${index}`,
        route: {
            channel: Channel.Stdio,
            chatId: "stress-chat",
            chatType: ChatType.Direct,
            threadId: "stress-thread",
        },
        user: {
            id: "stress-user",
        },
        text,
        receivedAt: contextFor(index).now,
    };
}

function replyFor(text: string, index: number): GatewayReply {
    return {
        messageId: `reply-${index}`,
        route: messageFor("", index).route,
        text,
    };
}

function contextFor(index: number): RuntimeContext {
    return {
        requestId: `request-${index}`,
        now: new Date(Date.UTC(2026, 4, 9, 2, 0, index)).toISOString(),
    };
}

function testPaths(root: string): FlyflorPaths {
    return {
        home: join(root, "home"),
        configDir: join(root, "home"),
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        workspaceDir: join(root, "home", "workspace"),
        logDir: join(root, "home", "logs"),
        memoryDir: join(root, "data", "memory"),
        pluginDir: join(root, "home", "plugins"),
        skillDir: join(root, "home", "skills"),
        mcpDir: join(root, "home", "mcp"),
    };
}

function summarize(values: number[]): LatencyStats {
    const sorted = [...values].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        avg: total / Math.max(1, sorted.length),
        max: sorted.at(-1) ?? 0,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
    };
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function latencyCells(stats: LatencyStats): string {
    return `${fixed(stats.avg)} | ${fixed(stats.p50)} | ${fixed(stats.p95)} | ${fixed(stats.max)}`;
}

function tableRow(cells: Array<number | string>): string {
    return `| ${cells.join(" | ")} |`;
}

function boolCell(value: boolean): string {
    return value ? "yes" : "no";
}

function fixed(value: number): string {
    return value.toFixed(3);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
