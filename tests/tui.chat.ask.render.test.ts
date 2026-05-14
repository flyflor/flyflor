import { describe, expect, test } from "bun:test";
import { formatAskSummaryLines } from "../src/command/tui/chat/ask.render.ts";

describe("TUI ask summary rendering", () => {
    test("adds an Other option whenever choices exist", () => {
        const lines = formatAskSummaryLines({
            choiceCount: 2,
            choices: [
                { label: "main", value: "main" },
                { label: "scratch", value: "scratch", description: "throwaway area" },
            ],
            prompt: "Which workspace should I use?",
            questionCount: 1,
            questions: [
                {
                    prompt: "Should I proceed now?",
                    choices: [{ label: "yes", value: "yes" }],
                },
            ],
            reason: "user-intent-unclear",
            snapshotId: "behavior-1",
        });

        expect(lines).toEqual([
            "  prompt: Which workspace should I use?",
            "  choices:",
            "    1. main",
            "    2. scratch — throwaway area",
            "    o. Other — type your own answer",
            "  questions:",
            "    1. Should I proceed now?",
            "      1. yes",
            "      o. Other — type your own answer",
        ]);
    });
});
