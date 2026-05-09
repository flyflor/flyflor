import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import { AgentSession, scopeFor, SQLiteMemoryStore } from "../src/control/index.ts";
import { Channel, ChatType, type GatewayMessage, type GatewayReply, type RuntimeContext } from "../src/fpc/index.ts";

interface SessionCase {
    accountId?: string;
    channel: typeof Channel.Stdio | typeof Channel.Webhook;
    chatId: string;
    marker: string;
    threadId?: string;
    userId: string;
}

interface LatencyBucket {
    consolidate: number[];
    recent: number[];
    record: number[];
    timeline: number[];
}

interface SessionCheck {
    historyEntries: number;
    key: string;
    lastConsolidatedSequence: number;
    liveMessages: number;
    maxSequence: number;
    minRecentSequence: number;
    totalMessages: number;
}

const args = parseArgs();
const sessionCount = numberArg("sessions", 12);
const turnsPerSession = numberArg("turns", 60);
const keepRoot = booleanArg("keep");
const root = args.get("root") ?? (await mkdtemp(join(tmpdir(), "flyflor-session-stress-")));
const shouldCleanup = !keepRoot && !args.has("root");
const paths = testPaths(root);
const config = await stressConfig(paths);
const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
const session = new AgentSession(store, config.memory.session);
const cases = createCases(sessionCount);
const latencies: LatencyBucket = {
    consolidate: [],
    recent: [],
    record: [],
    timeline: [],
};
const failures: string[] = [];
const started = performance.now();

for (let turn = 0; turn < turnsPerSession; turn += 1) {
    for (const item of cases) {
        const text = inputText(item, turn);
        const message = gatewayMessage(item, text, turn);
        const reply = gatewayReply(item, `ack ${item.marker} turn ${turn}`, message);
        const context = runtimeContext(turn);

        await measure(latencies.record, () => session.recordTurn(message, reply, context));
        await measure(latencies.consolidate, () => session.consolidate(scopeFor(message), context.now));
    }
}

const checks: SessionCheck[] = [];
const summaries = await session.list(sessionCount + 5);
const summaryByKey = new Map(summaries.map((summary) => [summary.key, summary]));

for (const item of cases) {
    const probe = gatewayMessage(item, "probe", turnsPerSession + 1);
    const key = scopeFor(probe);
    const summary = summaryByKey.get(key);
    const timeline = await measure(latencies.timeline, () => session.timeline(key, turnsPerSession * 2 + 5));
    const recent = await measure(latencies.recent, () => session.recentMessagesFor(probe));
    const expectedMessages = turnsPerSession * 2;
    const sequences = timeline.map((message) => message.sequence);
    const historyEntries = countHistoryEntries(paths, key);
    const maxSequence = Math.max(...sequences);
    const minRecentSequence = Math.min(...recent.map((message) => message.sequence));

    if (!summary) {
        failures.push(`missing summary: ${key}`);
        continue;
    }
    if (summary.totalMessageCount !== expectedMessages) {
        failures.push(`${key} total messages expected ${expectedMessages}, got ${summary.totalMessageCount}`);
    }
    if (summary.liveMessageCount > config.memory.session.maxLiveMessages) {
        failures.push(
            `${key} live messages ${summary.liveMessageCount} exceeded ${config.memory.session.maxLiveMessages}`,
        );
    }
    if (timeline.length !== expectedMessages) {
        failures.push(`${key} timeline length expected ${expectedMessages}, got ${timeline.length}`);
    }
    if (!isContiguous(sequences, expectedMessages)) {
        failures.push(`${key} timeline sequence is not contiguous`);
    }
    if (recent.some((message) => message.sequence <= summary.lastConsolidatedSequence)) {
        failures.push(`${key} recent messages leaked consolidated history`);
    }
    if (
        timeline.some((message) =>
            cases.some((other) => other.marker !== item.marker && message.content.includes(other.marker)),
        )
    ) {
        failures.push(`${key} leaked another session marker`);
    }
    if (historyEntries === 0) {
        failures.push(`${key} did not consolidate into history`);
    }

    checks.push({
        historyEntries,
        key,
        lastConsolidatedSequence: summary.lastConsolidatedSequence,
        liveMessages: summary.liveMessageCount,
        maxSequence,
        minRecentSequence,
        totalMessages: summary.totalMessageCount,
    });
}

const redactionTimeline = await session.timeline(scopeFor(gatewayMessage(cases[0]!, "probe", 0)), turnsPerSession * 2);
const redactionText = redactionTimeline.map((message) => message.content).join("\n");
if (
    redactionText.includes("sk-1234567890abcdefghijkl") ||
    redactionText.includes("abcdefghijklmnopqrstuvwx.abcdef.abcdefghijklmnopqrstuvwx")
) {
    failures.push("credential-like content was not redacted in session timeline");
}
if (!redactionText.includes("[redacted-api-key]") || !redactionText.includes("[redacted-token]")) {
    failures.push("redaction placeholders were not found in session timeline");
}

const thresholds = [
    ["recordTurn p95", percentile(latencies.record, 0.95), 25],
    ["consolidate p95", percentile(latencies.consolidate, 0.95), 20],
    ["timeline p95", percentile(latencies.timeline, 0.95), 15],
    ["recent p95", percentile(latencies.recent, 0.95), 10],
] as const;
for (const [name, value, limit] of thresholds) {
    if (value > limit) {
        failures.push(`${name} ${value.toFixed(3)} ms exceeded ${limit} ms`);
    }
}

const elapsedMs = performance.now() - started;
const report = renderReport({
    checks,
    config,
    elapsedMs,
    failures,
    latencies,
    paths,
    root,
    sessionCount,
    turnsPerSession,
});
await Bun.write("docs/SESSION_STRESS_REPORT.md", report);
console.log(report);

if (shouldCleanup) {
    await rm(root, { force: true, recursive: true });
}

if (failures.length > 0) {
    process.exit(1);
}

function parseArgs(): Map<string, string> {
    const result = new Map<string, string>();
    for (let index = 2; index < process.argv.length; index += 1) {
        const item = process.argv[index] ?? "";
        if (!item.startsWith("--")) {
            continue;
        }
        const next = process.argv[index + 1];
        result.set(item.slice(2), next && !next.startsWith("--") ? next : "true");
    }
    return result;
}

function numberArg(name: string, fallback: number): number {
    const value = Number(args.get(name));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function booleanArg(name: string): boolean {
    return args.get(name) === "true";
}

function createCases(count: number): SessionCase[] {
    return Array.from({ length: count }, (_, index) => ({
        accountId: index % 3 === 0 ? "account-a" : index % 3 === 1 ? "account-b" : undefined,
        channel: index % 2 === 0 ? Channel.Stdio : Channel.Webhook,
        chatId: `chat-${index % 4}`,
        marker: `SESSION_MARKER_${String(index).padStart(2, "0")}`,
        threadId: index % 2 === 0 ? `thread-${index}` : undefined,
        userId: `user-${index % 5}`,
    }));
}

function inputText(item: SessionCase, turn: number): string {
    if (turn === 0 && item.marker === "SESSION_MARKER_00") {
        return `${item.marker} secret sk-1234567890abcdefghijkl jwt abcdefghijklmnopqrstuvwx.abcdef.abcdefghijklmnopqrstuvwx`;
    }
    return `${item.marker} user turn ${turn}`;
}

function gatewayMessage(item: SessionCase, text: string, turn: number): GatewayMessage {
    return {
        id: `${item.marker}:message:${turn}`,
        route: {
            accountId: item.accountId,
            channel: item.channel,
            chatId: item.chatId,
            chatType: ChatType.Direct,
            threadId: item.threadId,
        },
        user: {
            id: item.userId,
        },
        text,
        receivedAt: timestamp(turn),
    };
}

function gatewayReply(item: SessionCase, text: string, message: GatewayMessage): GatewayReply {
    return {
        messageId: `${item.marker}:reply:${message.id}`,
        route: message.route,
        text,
    };
}

function runtimeContext(turn: number): RuntimeContext {
    return {
        requestId: crypto.randomUUID(),
        now: timestamp(turn),
    };
}

function timestamp(turn: number): string {
    return new Date(Date.UTC(2026, 4, 9, 7, 0, turn)).toISOString();
}

async function measure<T>(bucket: number[], run: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
        return await run();
    } finally {
        bucket.push(performance.now() - startedAt);
    }
}

function countHistoryEntries(paths: FlyflorPaths, sessionKey: string): number {
    const db = new Database(join(paths.memoryDir, "memory.sqlite"), { readonly: true });
    try {
        return Number(
            (
                db.query("SELECT COUNT(*) AS count FROM history_entries WHERE session_key = ?").get(sessionKey) as {
                    count: number;
                }
            ).count,
        );
    } finally {
        db.close();
    }
}

function isContiguous(sequences: number[], expected: number): boolean {
    if (sequences.length !== expected) {
        return false;
    }
    return sequences.every((sequence, index) => sequence === index + 1);
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
    return sorted[index] ?? 0;
}

function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values: number[]): number {
    return values.length === 0 ? 0 : Math.max(...values);
}

function table(headers: string[], rows: Array<Array<number | string>>): string {
    const allRows = [headers, ...rows.map((row) => row.map(String))];
    const widths = headers.map((_, column) => Math.max(...allRows.map((row) => String(row[column] ?? "").length), 3));
    const render = (row: Array<number | string>) =>
        `| ${row.map((cell, column) => String(cell).padEnd(widths[column] ?? 3, " ")).join(" | ")} |`;
    const line = render(headers);
    const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
    const body = rows.map(render).join("\n");
    return [line, separator, body].join("\n");
}

function fixed(value: number): string {
    return value.toFixed(3);
}

function renderReport(input: {
    checks: SessionCheck[];
    config: FlyflorConfig;
    elapsedMs: number;
    failures: string[];
    latencies: LatencyBucket;
    paths: FlyflorPaths;
    root: string;
    sessionCount: number;
    turnsPerSession: number;
}): string {
    const totalTurns = input.sessionCount * input.turnsPerSession;
    const totalMessages = totalTurns * 2;
    const latencyRows = [
        [
            "recordTurn",
            fixed(average(input.latencies.record)),
            fixed(percentile(input.latencies.record, 0.5)),
            fixed(percentile(input.latencies.record, 0.95)),
            fixed(max(input.latencies.record)),
        ],
        [
            "consolidate",
            fixed(average(input.latencies.consolidate)),
            fixed(percentile(input.latencies.consolidate, 0.5)),
            fixed(percentile(input.latencies.consolidate, 0.95)),
            fixed(max(input.latencies.consolidate)),
        ],
        [
            "timeline",
            fixed(average(input.latencies.timeline)),
            fixed(percentile(input.latencies.timeline, 0.5)),
            fixed(percentile(input.latencies.timeline, 0.95)),
            fixed(max(input.latencies.timeline)),
        ],
        [
            "recent",
            fixed(average(input.latencies.recent)),
            fixed(percentile(input.latencies.recent, 0.5)),
            fixed(percentile(input.latencies.recent, 0.95)),
            fixed(max(input.latencies.recent)),
        ],
    ];
    const checkRows = input.checks.map((check) => [
        check.key,
        check.totalMessages,
        check.liveMessages,
        check.historyEntries,
        check.lastConsolidatedSequence,
        check.minRecentSequence,
        check.maxSequence,
    ]);
    const manualCommands = [
        "```bash",
        `bun run test:session:stress -- --sessions ${input.sessionCount} --turns ${input.turnsPerSession} --keep`,
        `bun run inspect:sessions -- --db ${join(input.paths.memoryDir, "memory.sqlite")} --limit 20`,
        `bun run inspect:sessions -- --db ${join(input.paths.memoryDir, "memory.sqlite")} --session ${input.checks[0]?.key ?? "SESSION_KEY"} --limit 30`,
        "```",
    ].join("\n");

    return [
        "# Flyflor Session 压力测试报告",
        "",
        "<!-- prettier-ignore-start -->",
        "",
        `生成时间：${new Date().toISOString()}`,
        "",
        "## 测试范围",
        "",
        "本报告专门验证 `src/control/session` 边界和 SQLite session 存储：session key 隔离、timeline 顺序、live context、history 固化、凭据脱敏和响应延迟。",
        "",
        "## 压测规模",
        "",
        table(
            ["项目", "数值"],
            [
                ["session 数", input.sessionCount],
                ["每个 session turn 数", input.turnsPerSession],
                ["总 turn 数", totalTurns],
                ["总 session message 数", totalMessages],
                ["maxLiveMessages", input.config.memory.session.maxLiveMessages],
                ["consolidationBatchSize", input.config.memory.session.consolidationBatchSize],
                ["maxPromptMessages", input.config.memory.session.maxPromptMessages],
                ["总耗时 ms", fixed(input.elapsedMs)],
            ],
        ),
        "",
        "## Session 汇总",
        "",
        table(["Session Key", "Total", "Live", "History", "Last Consolidated", "Min Recent Seq", "Max Seq"], checkRows),
        "",
        "## 延迟统计",
        "",
        table(["路径", "Avg ms", "P50 ms", "P95 ms", "Max ms"], latencyRows),
        "",
        "## 红线检查",
        "",
        input.failures.length === 0 ? "- 红线失败数：0" : input.failures.map((failure) => `- ${failure}`).join("\n"),
        "",
        "## 人工复核命令",
        "",
        "如果需要保留本次临时数据库供人工查看，请使用 `--keep` 重新运行：",
        "",
        manualCommands,
        "",
        "人工重点看：",
        "",
        "- `total` 必须等于 `turns * 2`。",
        "- `live` 必须小于等于 `maxLiveMessages`。",
        "- `sequence` 必须连续递增。",
        "- 同一个 session 的消息只包含自己的 `SESSION_MARKER_xx`。",
        "- 第一条 session 的 raw token 不应出现，只应看到 `[redacted-api-key]` 和 `[redacted-token]`。",
        "",
        "<!-- prettier-ignore-end -->",
        "",
    ].join("\n");
}

async function stressConfig(paths: FlyflorPaths): Promise<FlyflorConfig> {
    const config = await loadConfigForPaths(paths);
    return {
        ...config,
        memory: {
            ...config.memory,
            session: {
                consolidationBatchSize: 10,
                maxHistoryEntryChars: 4096,
                maxLiveMessages: 20,
                maxPromptMessages: 12,
            },
            sqlite: {
                ...config.memory.sqlite,
                maxPromptItems: 12,
            },
        },
    };
}

function testPaths(rootPath: string): FlyflorPaths {
    return {
        cacheDir: join(rootPath, "cache"),
        configDir: join(rootPath, "home"),
        home: join(rootPath, "home"),
        logDir: join(rootPath, "home", "logs"),
        mcpDir: join(rootPath, "home", "mcp"),
        memoryDir: join(rootPath, "data", "memory"),
        pluginDir: join(rootPath, "home", "plugins"),
        skillDir: join(rootPath, "home", "skills"),
        storageDir: join(rootPath, "data"),
        workspaceDir: join(rootPath, "home", "workspace"),
    };
}
