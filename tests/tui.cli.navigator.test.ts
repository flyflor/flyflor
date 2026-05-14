import { describe, expect, test } from "bun:test";
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
});
