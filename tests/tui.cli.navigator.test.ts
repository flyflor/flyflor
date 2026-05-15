import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { listCliTuiPages, type CliPage } from "../src/command/tui/cli/index.ts";

describe("CLI TUI navigator", () => {
    test("covers the major interactive command pages", () => {
        const pages = listCliTuiPages().map((item) => item.page);
        const expected: CliPage[] = [
            "overview",
            "config",
            "skills",
            "mcp",
            "plugins",
            "sandbox",
            "blackboard",
            "memory",
            "ghosts",
            "dream",
        ];

        expect(pages).toEqual(expected);
    });

    test("returns defensive copies of page metadata", () => {
        const first = listCliTuiPages();
        first[0]!.title = "Changed";

        expect(listCliTuiPages()[0]!.title).toBe("Overview");
    });

    test("interactive TUI entrypoints use the shared one-shot lifecycle guard", async () => {
        const files = await Promise.all([
            readFile("src/command/tui/index.tsx", "utf8"),
            readFile("src/command/tui/cli/index.ts", "utf8"),
            readFile("src/command/tui/cli/blackboard.browser.tsx", "utf8"),
            readFile("src/command/tui/chat/index.ts", "utf8"),
        ]);

        for (const source of files) {
            expect(source).toContain("createTuiLifecycle");
            expect(source).not.toContain('process.once("SIGINT"');
            expect(source).not.toContain('process.once("SIGTERM"');
        }
    });
});
