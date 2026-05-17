import { describe, expect, test } from "bun:test";
import { clearOpenTuiEnvCacheForChat } from "../src/command/tui/chat/index.ts";
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

describe("TUI chat OpenTUI env cache", () => {
    test("does not crash when compiled OpenTUI env singleton is missing", () => {
        expect(() =>
            clearOpenTuiEnvCacheForChat(() => {
                throw new TypeError("undefined is not an object (evaluating 'envStore.clearCache')");
            }),
        ).not.toThrow();
    });

    test("surfaces unrelated OpenTUI env cache errors", () => {
        expect(() =>
            clearOpenTuiEnvCacheForChat(() => {
                throw new TypeError("permission denied while clearing cache");
            }),
        ).toThrow("permission denied");
    });
});
