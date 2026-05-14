import { describe, expect, test } from "bun:test";
import { osc52ClipboardSequence } from "../src/command/tui/chat/clipboard.ts";

describe("TUI chat clipboard", () => {
    test("builds an OSC52 clipboard sequence", () => {
        expect(osc52ClipboardSequence("hello")).toBe("\u001b]52;c;aGVsbG8=\u0007");
    });

    test("wraps OSC52 for tmux", () => {
        const previousTmux = process.env.TMUX;
        process.env.TMUX = "1";
        try {
            expect(osc52ClipboardSequence("hello")).toBe("\u001bPtmux;\u001b\u001b]52;c;aGVsbG8=\u0007\u001b\\");
        } finally {
            if (previousTmux === undefined) {
                delete process.env.TMUX;
            } else {
                process.env.TMUX = previousTmux;
            }
        }
    });
});
