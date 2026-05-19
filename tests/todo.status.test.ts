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
    });

    test("active docs now describe only ws/event gateway as mainline surface", async () => {
        const [todo, readme, architecture, directory, boundaries, controlProtocol] = await Promise.all([
            readFile(ROOT_TODO_PATH, "utf8"),
            readFile(README_PATH, "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "architecture.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "directory.architecture.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "boundaries.md"), "utf8"),
            readFile(join(import.meta.dir, "..", "docs", "control.protocol.md"), "utf8"),
        ]);

        const active = `${todo}\n${readme}\n${architecture}\n${directory}\n${boundaries}\n${controlProtocol}`;
        expect(active).toContain("WS");
        expect(active).toContain("control");
        expect(active).toContain("event");
        expect(active).toContain("Rust");
        expect(active).toContain("主源码移除");
    });

    test("abandon remains backup-only and not a mainline runtime dependency", async () => {
        const abandonReadme = await readFile(join(import.meta.dir, "..", "abandon", "README.md"), "utf8");
        expect(abandonReadme).toContain("废弃代码备份");
        expect(abandonReadme).toContain("不是兼容层");
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
