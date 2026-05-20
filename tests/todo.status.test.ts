import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT_TODO_PATH = join(import.meta.dir, "..", "TODO.md");
const README_PATH = join(import.meta.dir, "..", "README.md");

describe("TODO status", () => {
    test("root TODO stays present and tracks the active architecture handoff", async () => {
        expect(await exists(ROOT_TODO_PATH)).toBe(true);
        const todo = await readFile(ROOT_TODO_PATH, "utf8");

        expect(todo).toContain("Cognitive-Executive-Agent Architecture");
        expect(todo).toContain("R7 Surface Amputation");
        expect(todo).toContain("R8 Vascular Freeze");
        expect(todo).toContain("R9 Computer Exoskeleton");
        expect(todo).toContain("R10 Long-Horizon Loop");
        expect(todo).toContain("gateway");
        expect(todo).toContain("WebSocket");
        expect(todo).toContain("Rust");
        expect(todo).toContain("docs/rust.connection.core.md");
    });

    test("active docs now describe only ws/event gateway as mainline surface", async () => {
        const [todo, readme, architecture, docsIndex, gateway, directory, boundaries, controlProtocol] = await Promise.all([
            readFile(ROOT_TODO_PATH, "utf8"),
            readFile(README_PATH, "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "architecture.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "README.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "gateway.channels.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "directory.architecture.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "boundaries.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "control.protocol.md"), "utf8"),
        ]);

        const active = `${todo}\n${readme}\n${architecture}\n${docsIndex}\n${gateway}\n${directory}\n${boundaries}\n${controlProtocol}`;
        expect(active).toContain("WS");
        expect(active).toContain("/ws");
        expect(active).toContain("/health");
        expect(active).toContain("/channels");
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

    test("abandon remains backup-only and not a mainline runtime dependency", async () => {
        const abandonReadme = await readFile(join(import.meta.dir, "..", "abandon", "README.md"), "utf8");
        expect(abandonReadme).toContain("废弃代码备份");
        expect(abandonReadme).toContain("不是兼容层");
    });

    test("roadmap and todo stay aligned on the sealed Bun kernel state", async () => {
        const [todo, roadmap, readme] = await Promise.all([
            readFile(ROOT_TODO_PATH, "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "refactor.roadmap.md"), "utf8"),
            readFile(README_PATH, "utf8"),
        ]);

        expect(todo).toContain("kernel:seal");
        expect(todo).toContain("已在真实 provider 下跑通");
        expect(roadmap).toContain("Bun 内核封板已完成");
        expect(roadmap).toContain("0 漂移维护");
        expect(roadmap).toContain("TODO.md");
        expect(readme).toContain("bun run kernel:seal");
        expect(readme).toContain("bun run test:kernel");
        expect(readme).toContain("kernel:seal 下缺真实 provider 会直接失败");
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
