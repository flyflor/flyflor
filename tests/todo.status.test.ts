import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT_TODO_PATH = join(import.meta.dir, "..", "TODO.md");
const ARCHIVED_TODO_PATH = join(import.meta.dir, "..", "docs", "old-docs", "todo.next.md");
const BLACKBOARD_DOC_PATH = join(import.meta.dir, "..", "docs", "blackboard.md");
const SANDBOX_DOC_PATH = join(import.meta.dir, "..", "docs", "sandbox.capabilities.md");
const ARCHITECTURE_DOC_PATH = join(import.meta.dir, "..", "docs", "architecture.md");
const CLI_DOC_PATH = join(import.meta.dir, "..", "docs", "cli.commands.md");
const PLUGIN_REGISTRY_PATH = join(import.meta.dir, "..", "src", "agent", "plugin", "registry.ts");
const README_PATH = join(import.meta.dir, "..", "README.md");

describe("TODO status", () => {
    test("does not keep stale documentation automation gaps after docs:check", async () => {
        const todo = await readFile(ARCHIVED_TODO_PATH, "utf8");
        const stalePhrases = [
            "待后续自动生成",
            "CLI / TODO 侧",
            "CLI 侧仍待",
            "TODO / 跨文档状态",
            "TODO 状态仍待",
        ];

        const present = stalePhrases.filter((phrase) => todo.includes(phrase));
        expect(present).toEqual([]);
        expect(todo).toContain("docs:check");
    });

    test("root TODO is the active Chinese handoff roadmap", async () => {
        expect(await exists(ROOT_TODO_PATH)).toBe(true);
        const todo = await readFile(ROOT_TODO_PATH, "utf8");

        expect(todo).toContain("Cognitive-Executive-Agent Architecture");
        expect(todo).toContain("路径说明");
        expect(todo).toContain("Bun 单文件二进制");
        expect(todo).toContain("零字符匹配红线");
        expect(todo).toContain("bun run docs:check");
        expect(todo).toContain("bun run build:binary");
        expect(todo).toContain("src/cognitive");
        expect(todo).toContain("src/executive");
        expect(todo).toContain("src/agent/skills");
        expect(todo).toContain("src/agent/context");
    });

    test("R5 and R6 are closed with a clear handoff snapshot", async () => {
        const [todo, roadmap, agents, readme, boundaries] = await Promise.all([
            readFile(ROOT_TODO_PATH, "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "refactor.roadmap.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "AGENTS.md"), "utf8"),
            readFile(README_PATH, "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "boundaries.md"), "utf8"),
        ]);

        expect(todo).toContain("R5 External Kit Protocol");
        expect(todo).toContain("状态：已完成");
        expect(todo).toContain("R6 Release Gate And Cleanup");
        expect(todo).toContain("状态：已完成");
        expect(todo).toContain("换 session 交接快照");
        expect(todo).toContain("发布前 diff review");
        expect(roadmap).toContain("R5 已完成 kit/control 发现边界");
        expect(roadmap).toContain("状态：已完成");
        expect(roadmap).toContain("本轮已验证");
        expect(agents).toContain("历史旧物理路径 `src/fch`、`src/cttl`、`src/skills`、`src/context` 已移除");
        expect(agents).not.toContain("只能作为兼容窗口");
        expect(readme).toContain("External Kit manifest");
        expect(boundaries).toContain("kit discovery 不得 import Runtime 私有实现");
    });

    test("active handoff docs do not describe R5/R6 as future work", async () => {
        const [todo, runtimeEvents, mcpTools, directoryArchitecture] = await Promise.all([
            readFile(ROOT_TODO_PATH, "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "runtime.events.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "mcp.tools.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "directory.architecture.md"), "utf8"),
        ]);

        const active = `${todo}\n${runtimeEvents}\n${mcpTools}\n${directoryArchitecture}`;
        expect(active).not.toContain("进入 R5");
        expect(active).not.toContain("进入 R6");
        expect(active).not.toContain("迁移期内置 CLI/TUI");
        expect(active).not.toContain("resources / prompts 先进入 Executive descriptor 与发现测试，后续再接读取");
        expect(active).not.toContain("未完成迁移的旧物理路径只作为兼容窗口存在");
    });

    test("archived active TODO points at the root handoff roadmap", async () => {
        const archivedActive = await readFile(join(import.meta.dir, "..", "docs", "old-docs", "todo.active.md"), "utf8");
        expect(archivedActive).toContain("当前接续路线移动到根目录");
        expect(archivedActive).toContain("../../TODO.md");
    });

    test("blackboard docs reflect current worker isolation status", async () => {
        const doc = await readFile(BLACKBOARD_DOC_PATH, "utf8");
        // TODO.md may keep struck-through historical records; the canonical blackboard doc
        // should describe the current partial isolation state instead of the old gap.
        expect(doc).not.toContain("进程隔离（Bun Worker / 子进程）阶段未完成");
        expect(doc).not.toContain("仍**未实时流式订阅 worker.step**");
        expect(doc).toContain("blackboard 与 reflection 的 raw → structured 规范化走 Bun Worker");
        expect(doc).toContain("WorkerManager.registerRawStdioProcess");
    });

    test("sandbox docs describe the current unified gate instead of the old mode matrix", async () => {
        const [sandboxDoc, architectureDoc] = await Promise.all([
            readFile(SANDBOX_DOC_PATH, "utf8"),
            readFile(ARCHITECTURE_DOC_PATH, "utf8"),
        ]);
        const stalePhrases = [
            "`strict`",
            "`interactive`",
            "`allowlist`",
            "Plugin runtime 与 Shell hook 执行链未",
            "缺独立的 `~/.flyflor/sandbox.allow.jsonc`",
            "没有「逐次仅允许 N 次」",
            "审计 sink 不可插拔",
            "`yolo` 模式没有冷却",
            "仅在 `RuntimeModule` 内决策 mcp-tool",
        ];

        const combined = `${sandboxDoc}\n${architectureDoc}`;
        const present = stalePhrases.filter((phrase) => combined.includes(phrase));
        expect(present).toEqual([]);
        expect(sandboxDoc).not.toContain("src/agent/plugins/*");
        expect(sandboxDoc).toContain("src/agent/plugin/runner.ts");
        expect(sandboxDoc).toContain("gateCapabilityExecution");
        expect(sandboxDoc).toContain("SandboxQuotaTracker");
        expect(sandboxDoc).toContain("HttpAuditSink");
    });

    test("generated CLI docs do not claim TODO drift remains open", async () => {
        const doc = await readFile(CLI_DOC_PATH, "utf8");
        expect(doc).not.toContain("still need to converge to avoid drift");
        expect(doc).not.toContain("we can also add checks");
        expect(doc).toContain("checked for drift by `docs:check`");
    });

    test("boundaries docs do not reference the removed focus directory", async () => {
        const doc = await readFile(join(import.meta.dir, "..", "docs", "boundaries.md"), "utf8");
        // Focus is now a protocol/memory continuity concept, not a standalone
        // agent directory. Keeping this guard prevents the old service-style
        // layer from coming back through documentation drift.
        expect(doc).not.toContain("blackboard / focus / sandbox");
        expect(doc).not.toContain("`focus` 是当前注意力指针的唯一计算入口");
        expect(doc).toContain("`FocusPointer` 协议字段");
    });

    test("plugin registry comments match the shipped sandboxed runner", async () => {
        const source = await readFile(PLUGIN_REGISTRY_PATH, "utf8");
        // Plugin execution is implemented by PluginRunner. Active source
        // comments must not keep the old planning note that execution is absent.
        expect(source).not.toContain("不在本批次实现 plugin 加载/执行");
        expect(source).toContain("PluginRunner");
        expect(source).toContain("CapabilityExecutionKind.Plugin");
    });
});

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}
