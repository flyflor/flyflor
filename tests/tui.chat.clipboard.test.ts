import { describe, expect, test } from "bun:test";
import { osc52ClipboardSequence } from "../src/command/tui/chat/clipboard.ts";
import { selectedTextForScope } from "../src/command/tui/chat/app.tsx";

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

    test("copies only text from the panel where selection starts", () => {
        const chatRoot = fakeRenderable("chat-root", "");
        const sideRoot = fakeRenderable("side-root", "");
        const chatLine = fakeRenderable("chat-line", "selected code", chatRoot);
        const sideLine = fakeRenderable("side-line", "Analysis panel", sideRoot);
        const selection = {
            getSelectedText: () => "selected code\nAnalysis panel",
            selectedRenderables: [chatLine, sideLine],
        };

        expect(selectedTextForScope(selection as never, "chat", { chat: chatRoot as never, side: sideRoot as never })).toBe(
            "selected code",
        );
        expect(selectedTextForScope(selection as never, "side", { chat: chatRoot as never, side: sideRoot as never })).toBe(
            "Analysis panel",
        );
    });
});

interface FakeRenderable {
    id: string;
    parent: FakeRenderable | null;
    x: number;
    y: number;
    getSelectedText: () => string;
}

function fakeRenderable(id: string, text: string, parent: FakeRenderable | null = null): FakeRenderable {
    return {
        id,
        parent,
        x: 0,
        y: parent ? 1 : 0,
        getSelectedText: () => text,
    };
}
