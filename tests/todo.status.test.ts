import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT_TODO_PATH = join(import.meta.dir, "..", "TODO.md");
const README_PATH = join(import.meta.dir, "..", "README.md");

describe("TODO status", () => {
    test("root TODO stays present and tracks the active architecture handoff", async () => {
        expect(await exists(ROOT_TODO_PATH)).toBe(true);
        const todo = await readFile(ROOT_TODO_PATH, "utf8");

        expect(todo).toContain("当前交接");
        expect(todo).toContain("已封板契约");
        expect(todo).toContain("下一步工作");
        expect(todo).toContain("Cognitive-Executive-Agent Architecture");
        expect(todo).toContain("上下文装配是 `Memory + Crystal + explicit Scope/Fork + Executive visible capability surface`");
        expect(todo).toContain("最新 owner 口径：`src/socket` 拥有 socket 血管层。");
        expect(todo).toContain("gateway");
        expect(todo).toContain("WebSocket");
        expect(todo).toContain("Rust");
        expect(todo).toContain("docs/old-docs/rust.connection.core.md");
    });

    test("active docs now describe only ws/event gateway as mainline surface", async () => {
        const [todo, readme, architecture, docsIndex, directory, boundaries, controlProtocol] = await Promise.all([
            readFile(ROOT_TODO_PATH, "utf8"),
            readFile(README_PATH, "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "architecture.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "README.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "directory.architecture.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "boundaries.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "control.protocol.md"), "utf8"),
        ]);

        const active = `${todo}\n${readme}\n${architecture}\n${docsIndex}\n${directory}\n${boundaries}\n${controlProtocol}`;
        expect(active).toContain("WS");
        expect(active).toContain("/ws");
        expect(active).toContain("/health");
        expect(active).toContain("control");
        expect(active).toContain("event");
        expect(active).toContain("Rust");
        expect(active).toContain("主源码移除");
    });

    test("directory docs stay aligned with current top-level source layers", async () => {
        const directory = await readFile(join(import.meta.dir, "..", "docs", "directory.architecture.md"), "utf8");

        expect(directory).toContain("`src/agent`");
        expect(directory).toContain("`src/cognitive`");
        expect(directory).toContain("`src/executive`");
        expect(directory).toContain("`src/events`");
        expect(directory).toContain("`src/protocol`");
        expect(directory).toContain("`src/config`");
        expect(directory).toContain("`src/entities`");
        expect(directory).toContain("`src/components`");
        expect(directory).toContain("`src/types`");
    });

    test("retired material stays under old-docs without an active abandon root", async () => {
        expect(await exists(join(import.meta.dir, "..", "abandon"))).toBe(false);
        const docsReadme = await readFile(join(import.meta.dir, "..", "docs", "README.md"), "utf8");
        const oldDocsReadme = await readFile(join(import.meta.dir, "..", "docs", "old-docs", "README.md"), "utf8");
        expect(docsReadme).toContain("old-docs");
        expect(oldDocsReadme).toContain("归档文档");
        expect(oldDocsReadme).toContain("归档清单");
    });

    test("roadmap and todo stay aligned on the sealed Bun kernel state", async () => {
        const [todo, roadmap, readme] = await Promise.all([
            readFile(ROOT_TODO_PATH, "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "refactor.roadmap.md"), "utf8"),
            readFile(README_PATH, "utf8"),
        ]);

        expect(todo).toContain("本工作区最近一次封板验证已通过");
        expect(todo).toContain("`244 pass`，`0 fail`");
        expect(todo).toContain("`178 pass`，`0 fail`");
        expect(todo).toContain("ASK typed answer continuation 已闭合");
        expect(todo).toContain("gateway.message.undo");
        expect(todo).toContain("最大上下文窗口已改为动态解析");
        expect(roadmap).toContain("Bun 内核封板已完成");
        expect(roadmap).toContain("0 漂移维护");
        expect(roadmap).toContain("TODO.md");
        expect(readme).toContain("bun run kernel:seal");
        expect(readme).toContain("bun run test:kernel");
        expect(readme).toContain("missing live provider is a failure");
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
