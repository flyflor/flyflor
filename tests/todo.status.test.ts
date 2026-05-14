import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TODO_PATH = join(import.meta.dir, "..", "TODO.md");

describe("TODO status", () => {
    test("does not keep stale documentation automation gaps after docs:check", async () => {
        const todo = await readFile(TODO_PATH, "utf8");
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
});
