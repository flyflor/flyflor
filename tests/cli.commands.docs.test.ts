import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findUncoveredCliStatusPaths, renderCliCommandsDoc } from "../src/command/cli/commands.docs.ts";

describe("cli command docs generator", () => {
    test("matches the checked-in docs file", async () => {
        const generated = renderCliCommandsDoc().trimEnd();
        const checkedIn = (await readFile(join(import.meta.dir, "..", "docs", "cli.commands.md"), "utf8")).trimEnd();
        expect(generated).toBe(checkedIn);
    });

    test("command docs mention the blackboard browser entry", () => {
        expect(renderCliCommandsDoc()).toContain("Opens the blackboard browser TUI in a terminal");
        expect(renderCliCommandsDoc()).toContain("flyflor blackboard");
    });

    test("command docs mention scoped TUI copy and the CLI navigator", () => {
        const doc = renderCliCommandsDoc();

        expect(doc).toContain("copied within the panel where selection starts");
        expect(doc).toContain("CLI TUI navigator");
    });

    test("implementation status rows cover every command spec leaf", () => {
        expect(findUncoveredCliStatusPaths()).toEqual([]);
    });
});
