import { afterEach, describe, expect, test } from "bun:test";
import { readdir, readFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    EQ_DEFAULT_HALFLIFE_MS,
    EqLabel,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import type { EventSink } from "../src/protocol/events/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("EQ-01 slice C: peekEqState public API", () => {
    test("无 state → 返回 null（决策侧应优雅降级，不要 fallback 到关键词）", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            expect(memory.peekEqState("user-1")).toBeNull();
        } finally {
            memory.dispose();
        }
    });

    test("有 state → 返回已 decay 的快照（label/dominance 不衰减；valence/arousal/confidence 衰减）", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("一段消息"),
                gatewayReply("好", "msg-eqc-1"),
                runtimeContext(),
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "carrier",
                        eq: {
                            label: EqLabel.Anger,
                            valence: -0.8,
                            arousal: 0.6,
                            dominance: 0.4,
                            confidence: 1.0,
                        },
                    },
                ],
            );
            const immediate = memory.peekEqState("user-1");
            expect(immediate).not.toBeNull();
            expect(immediate!.label).toBe(EqLabel.Anger);
            expect(immediate!.dominance).toBeCloseTo(0.4, 3);

            // 一个半衰期之后：valence/arousal/confidence 折半，dominance 不变
            const stateRow = immediate!;
            const after = memory.peekEqState("user-1", stateRow.updatedAt + EQ_DEFAULT_HALFLIFE_MS);
            expect(after).not.toBeNull();
            expect(after!.valence).toBeCloseTo(-0.4, 3);
            expect(after!.arousal).toBeCloseTo(0.3, 3);
            expect(after!.dominance).toBeCloseTo(0.4, 3);
            expect(after!.confidence).toBeCloseTo(0.5, 3);
            expect(after!.label).toBe(EqLabel.Anger);
        } finally {
            memory.dispose();
        }
    });
});

describe("EQ-01 slice C: red-line audit — runtime/decision side does NOT keyword-derive EqLabel", () => {
    test("src/ 内不存在基于 EqLabel 值（joy/anger/sadness/fear/surprise）的关键词派生路径", async () => {
        const repoRoot = resolve(import.meta.dir, "..");
        const srcRoot = join(repoRoot, "src");
        const files = await collectTs(srcRoot);

        // 允许列表：
        //   - contracts/eq.ts：协议层封闭枚举本身
        //   - neural/memory/brain.store.ts：rowToEq 类型断言（不做语义判断）
        //   - 任何 *.test.ts（不在 src/ 内但保险起见）
        const allow = new Set<string>([
            join(srcRoot, "protocol", "contracts", "eq.ts"),
        ]);

        // 把 neutral 排除：是常见英文词，误报率高且与情绪派生无关
        const labels: readonly string[] = ["joy", "anger", "sadness", "fear", "surprise"];
        // EQ-02：directive 值同样禁止由消息文本派生
        const directiveValues: readonly string[] = ["calm-down", "match-energy"];
        const tokens: readonly string[] = [...labels, ...directiveValues];

        // 红线模式：直接做基于关键词的字符串匹配 → label。
        // 例：.includes("happy"), text.match(/joy/, .indexOf("anger") >= 0, ` === "joy"` 出现在条件语境
        // 这里粗筛 includes/indexOf/match 加 label 字面量；任何命中即视为可疑。
        const suspicious: Array<{ file: string; line: number; snippet: string; label: string }> = [];
        for (const file of files) {
            if (allow.has(file)) continue;
            const content = await readFile(file, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const ln = lines[i]!;
                for (const label of tokens) {
                    // 基于关键词派生：includes("joy") / indexOf("joy") / match(/joy/) / test(/joy/) / split("joy")
                    const patterns: RegExp[] = [
                        new RegExp(`\\.includes\\(\\s*["'\`]${label}["'\`]`, "i"),
                        new RegExp(`\\.indexOf\\(\\s*["'\`]${label}["'\`]`, "i"),
                        new RegExp(`\\.match\\([^)]*${label}[^)]*\\)`, "i"),
                        new RegExp(`\\.test\\([^)]*\\b${label}\\b[^)]*\\)`, "i"),
                        new RegExp(`\\.split\\(\\s*["'\`]${label}["'\`]`, "i"),
                    ];
                    if (patterns.some((p) => p.test(ln))) {
                        suspicious.push({ file, line: i + 1, snippet: ln.trim(), label });
                    }
                }
            }
        }
        if (suspicious.length > 0) {
            const detail = suspicious
                .map((s) => `${s.file}:${s.line} [label=${s.label}] ${s.snippet}`)
                .join("\n");
            throw new Error(
                `EQ-01 red line violated — runtime appears to derive EqLabel from message text via keyword match:\n${detail}`,
            );
        }
        expect(suspicious).toHaveLength(0);
    });
});

async function collectTs(root: string): Promise<string[]> {
    const out: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "dist") continue;
                stack.push(full);
            } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
                out.push(full);
            }
        }
    }
    return out;
}

class RecordingSink implements EventSink {
    publish(_event: { type: string; payload?: Record<string, unknown> }): void {
        // no-op
    }
}

async function tempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "flyflor-eq-decision-"));
    tempRoots.push(dir);
    return dir;
}

function testPaths(root: string): FlyflorPaths {
    const home = join(root, "home");
    const project = join(root, "project");
    return {
        home,
        configDir: home,
        storageDir: join(home, "storage"),
        cacheDir: join(home, "cache"),
        workspaceDir: join(home, "workspace"),
        logDir: join(home, "logs"),
        memoryDir: join(home, "memory"),
        journalDir: join(home, "journal"),
        projectMemoryDir: join(home, "memory", "projects"),
        pluginDir: join(home, "plugins"),
        promptDir: join(home, "prompts"),
        skillDir: join(home, "skills"),
        templateDir: join(home, "templates"),
        mcpDir: join(home, "mcp"),
        projectDir: project,
        projectFlyflorDir: join(project, ".flyflor"),
        projectSkillDir: join(project, ".flyflor", "skills"),
        projectMcpDir: join(project, ".flyflor", "mcp"),
        projectPluginDir: join(project, ".flyflor", "plugins"),
    };
}

async function makeConfig(): Promise<FlyflorConfig> {
    const root = await tempRoot();
    const paths = testPaths(root);
    const repoRoot = resolve(import.meta.dir, "..");
    await mkdir(dirname(paths.promptDir), { recursive: true });
    await symlink(join(repoRoot, "templates", "prompts"), paths.promptDir, "dir");
    await mkdir(dirname(paths.templateDir), { recursive: true });
    await symlink(join(repoRoot, "templates"), paths.templateDir, "dir");
    return await loadConfigForPaths(paths);
}

function gatewayMessage(text: string): GatewayMessage {
    return {
        id: `msg-${Math.random().toString(36).slice(2, 8)}`,
        receivedAt: new Date().toISOString(),
        text,
        attachments: [],
        user: { id: "user-1", displayName: "User" },
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-1" },
    };
}

function gatewayReply(text: string, messageId: string): GatewayReply {
    return {
        messageId,
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-1" },
        text,
    };
}

function runtimeContext(): RuntimeContext {
    return {
        requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
        now: new Date().toISOString(),
        embedding: [],
    };
}
