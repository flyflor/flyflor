import { describe, expect, test } from "bun:test";
import {
    readAskMeta,
    readBlackboardMeta,
    readMcpTrace,
    readPlanningMeta,
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

    test("reads ask metadata without parsing visible reply text", () => {
        expect(
            readAskMeta({
                kind: "ask",
                ask: {
                    choiceCount: 2,
                    choices: [
                        { label: "main", value: "main" },
                        { label: "scratch", value: "scratch", description: "throwaway area" },
                    ],
                    freeform: true,
                    prompt: "Which workspace should I use?",
                    questionCount: 3,
                    questions: [
                        {
                            prompt: "Which workspace?",
                            choices: [{ label: "main", value: "main" }],
                        },
                    ],
                    reason: "blackboard-stalemate",
                    snapshotId: "behavior-1",
                },
            }),
        ).toEqual({
            choiceCount: 2,
            choices: [
                { label: "main", value: "main" },
                { label: "scratch", value: "scratch", description: "throwaway area" },
            ],
            freeform: true,
            prompt: "Which workspace should I use?",
            questionCount: 3,
            questions: [
                {
                    prompt: "Which workspace?",
                    choices: [{ label: "main", value: "main" }],
                },
            ],
            reason: "blackboard-stalemate",
            snapshotId: "behavior-1",
        });
        expect(readAskMeta({ kind: "reply" })).toBeNull();
    });

    test("throws on malformed ask metadata instead of silently falling back", () => {
        expect(() =>
            readAskMeta({
                kind: "ask",
                ask: {
                    choiceCount: 1,
                    choices: [{ value: "missing-label" }],
                    prompt: "Pick one.",
                    questionCount: 0,
                    questions: [],
                    reason: "user-intent-unclear",
                    snapshotId: "behavior-1",
                },
            }),
        ).toThrow("Invalid ask metadata at ask.choices[0].label: missing string");
    });

    test("reads MCP trace and filters skill names", () => {
        expect(readMcpTrace({ ok: false, resultSummary: "bad", server: "fs", tool: "read" })).toEqual({
            ok: false,
            resultText: "bad",
            server: "fs",
            tool: "read",
        });
        expect(
            readMcpTrace({
                ok: true,
                resultSummaryMeta: { kind: "truncated", originalChars: 20_000, keyCount: 3 },
                server: "fs",
                tool: "search",
            }),
        ).toEqual({
            ok: true,
            resultText: "kind=truncated chars=20000 keys=3",
            resultSummaryMeta: { kind: "truncated", originalChars: 20_000, keyCount: 3 },
            server: "fs",
            tool: "search",
        });
        expect(readStringArray(["a", 1, "b", null])).toEqual(["a", "b"]);
    });

    test("throws on malformed MCP trace instead of hiding broken event payloads", () => {
        expect(() => readMcpTrace({ ok: true, tool: "read" })).toThrow(
            "Invalid MCP trace at server: missing string.",
        );
        expect(() => readMcpTrace({ ok: true, server: "workspace", tool: 42 })).toThrow(
            "Invalid MCP trace at tool: missing string.",
        );
    });

    test("reads planning metadata without parsing visible reply text", () => {
        expect(
            readPlanningMeta({
                planning: {
                    taskPlans: [
                        {
                            id: "plan-1",
                            title: "Release",
                            summary: "Ship the release.",
                            status: "in-progress",
                            progress: 0.5,
                            stepCount: 2,
                            completedStepCount: 1,
                            steps: [{ id: "s1", title: "Check", status: "done", order: 0 }],
                        },
                    ],
                    contextForks: [
                        {
                            id: "fork-1",
                            title: "Installer",
                            scopeSummary: "Installer only.",
                            maxContextTokens: 12000,
                        },
                    ],
                    scenes: [
                        {
                            id: "scene-1",
                            kind: "deep-think",
                            title: "Review",
                            summary: "Summary only.",
                        },
                    ],
                },
            }),
        ).toMatchObject({
            taskPlans: [{ id: "plan-1", completedStepCount: 1 }],
            contextForks: [{ id: "fork-1", maxContextTokens: 12000 }],
            scenes: [{ id: "scene-1", kind: "deep-think" }],
        });
    });
});
