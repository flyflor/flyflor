import { describe, expect, test } from "bun:test";
import { loadChatParsers } from "../src/command/tui/chat/parsers.config.ts";

describe("TUI chat markdown parsers", () => {
    test("loads markdown parsers for markdown rendering", async () => {
        const parsers = await loadChatParsers();
        expect(parsers.map((parser) => parser.filetype)).toEqual([
            "javascript",
            "typescript",
            "markdown",
            "markdown_inline",
        ]);
        expect(parsers[2]?.injectionMapping?.infoStringMap.md).toBe("markdown");
        expect(parsers[2]?.injectionMapping?.infoStringMap.tsx).toBe("typescriptreact");
    });
});
