import { describe, expect, test } from "bun:test";
import {
    readAskMeta,
    readBlackboardMeta,
    readMcpTrace,
    readStringArray,
} from "../src/command/tui/chat/metadata.parse.ts";

describe("TUI chat metadata parsing", () => {
    test("reads current nested blackboard metadata", () => {
        expect(
            readBlackboardMeta({
                blackboard: {
                    elapsedMs: 42,
                    messages: 3,
                    mode: "blackboard",
                    reason: "needs-user",
                    status: "needs-user",
                    turnId: "bb-1",
                },
            }),
        ).toEqual({
            elapsedMs: 42,
            messages: 3,
            mode: "blackboard",
            reason: "needs-user",
            status: "needs-user",
            turnId: "bb-1",
        });
    });

    test("keeps legacy flat blackboard metadata readable", () => {
        expect(
            readBlackboardMeta({
                blackboardElapsedMs: 7,
                blackboardMessages: 2,
                blackboardMode: "direct-with-watch",
                blackboardReason: "route-watch",
                blackboardStatus: "converged",
                blackboardTurnId: "bb-legacy",
            }),
        ).toMatchObject({
            elapsedMs: 7,
            messages: 2,
            mode: "direct-with-watch",
            reason: "route-watch",
            status: "converged",
            turnId: "bb-legacy",
        });
    });

    test("reads ask metadata without parsing ask prompt text", () => {
        expect(
            readAskMeta({
                kind: "ask",
                ask: {
                    choices: 2,
                    questions: 3,
                    reason: "blackboard-stalemate",
                    snapshotId: "behavior-1",
                },
            }),
        ).toEqual({
            choices: 2,
            questions: 3,
            reason: "blackboard-stalemate",
            snapshotId: "behavior-1",
        });
        expect(readAskMeta({ kind: "reply" })).toBeNull();
    });

    test("reads MCP trace and filters skill names", () => {
        expect(readMcpTrace({ ok: false, resultSummary: "bad", server: "fs", tool: "read" })).toEqual({
            ok: false,
            resultText: "bad",
            server: "fs",
            tool: "read",
        });
        expect(readStringArray(["a", 1, "b", null])).toEqual(["a", "b"]);
    });
});
