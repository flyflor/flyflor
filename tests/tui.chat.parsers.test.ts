import { describe, expect, test } from "bun:test";
import { loadChatAvatarArt, resolveChatAvatarPaths } from "../src/command/tui/chat/index.ts";
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

describe("TUI chat avatar asset", () => {
    test("checks source tree, docker workspace mount and cwd candidates", () => {
        const paths = resolveChatAvatarPaths("/tmp/flyflor-chat");

        expect(paths.some((path) => path.endsWith("/ui/avatar.txt"))).toBe(true);
        expect(paths).toContain("/workspace/ui/avatar.txt");
        expect(paths).toContain("/tmp/flyflor-chat/ui/avatar.txt");
    });

    test("loads the optional repo avatar text when present", async () => {
        const art = await loadChatAvatarArt();

        expect(art.length).toBeGreaterThan(0);
    });
});
