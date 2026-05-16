import { describe, expect, test } from "bun:test";
import { parsePlanningBlocks } from "../src/agent/runtime/planning/blocks.ts";
import { renderStructuredBlock, StructuredBlockProtocol } from "../src/protocol/index.ts";
import { SceneRecordKind, TaskPlanStatus } from "../src/protocol/contracts/index.ts";

describe("runtime planning structured blocks", () => {
    test("parses task plans, forks and scenes without visible prose leakage", () => {
        const raw = [
            "visible",
            renderStructuredBlock(StructuredBlockProtocol.TaskPlan, {
                title: "Ship release",
                summary: "Track the release work after an ask.",
                status: "in-progress",
                progress: 0.5,
                steps: [{ id: "s1", title: "Patch runtime", status: "done", order: 0 }],
            }),
            renderStructuredBlock(StructuredBlockProtocol.ContextFork, {
                title: "Installer fork",
                summary: "Separate installer decisions from the main topic.",
                scopeSummary: "Only install scripts and release docs are inherited.",
                maxContextTokens: 9000,
                inheritedEventIds: ["episode-a"],
            }),
            renderStructuredBlock(StructuredBlockProtocol.SceneRecord, {
                kind: "deep-think",
                title: "Route review",
                summary: "The model chose direct reply with a bounded plan.",
                visibleFacts: ["plan exists"],
                openQuestions: [],
            }),
        ].join("\n");

        const parsed = parsePlanningBlocks(raw, {
            blackboardTurnId: "bb-1",
            now: "2026-05-16T00:00:00.000Z",
            requestId: "req-1",
            sourceEventId: "episode-1",
            userId: "u1",
        });

        expect(parsed.text).toBe("visible");
        expect(parsed.dropped).toBe(0);
        expect(parsed.taskPlans[0]).toMatchObject({
            userId: "u1",
            title: "Ship release",
            status: TaskPlanStatus.InProgress,
            completedStepCount: 1,
            sourceEventId: "episode-1",
            sourceBlackboardTurnId: "bb-1",
        });
        expect(parsed.contextForks[0]).toMatchObject({
            userId: "u1",
            title: "Installer fork",
            inheritedEventIds: ["episode-1", "episode-a"],
        });
        expect(parsed.sceneRecords[0]).toMatchObject({
            kind: SceneRecordKind.DeepThink,
            blackboardTurnId: "bb-1",
            sourceEventId: "episode-1",
        });
    });

    test("drops malformed planning blocks and keeps visible text", () => {
        const raw = `hello\n<flyflor_task_plan>{"summary":"missing title"}</flyflor_task_plan>`;
        const parsed = parsePlanningBlocks(raw, {
            now: "bad-date",
            requestId: "req-1",
            userId: "u1",
        });
        expect(parsed.text).toBe("hello");
        expect(parsed.taskPlans).toEqual([]);
        expect(parsed.dropped).toBe(1);
    });
});
