import { describe, expect, test } from "bun:test";
import { SceneRecordKind, TaskPlanStatus } from "../src/protocol/contracts/index.ts";
import type { ContextForkRecord } from "../src/protocol/contracts/index.ts";

describe("planning protocol", () => {
    test("exports stable task-plan and scene record enums", () => {
        expect(TaskPlanStatus.Planned).toBe("planned");
        expect(TaskPlanStatus.InProgress).toBe("in-progress");
        expect(TaskPlanStatus.Blocked).toBe("blocked");
        expect(TaskPlanStatus.Done).toBe("done");
        expect(SceneRecordKind.Blackboard).toBe("blackboard");
        expect(SceneRecordKind.DeepThink).toBe("deep-think");
        expect(SceneRecordKind.Reflection).toBe("reflection");
    });

    test("supports summary-first context fork payloads", () => {
        const fork: ContextForkRecord = {
            id: "fork-1",
            userId: "u1",
            title: "Investigate install flow",
            summary: "Forked from the main thread to isolate installer work.",
            scopeSummary: "Only installer, docs, and release asset questions stay in scope.",
            maxContextTokens: 12_000,
            inheritedEventIds: ["e1", "e2"],
            createdAt: "2026-05-16T00:00:00.000Z",
            updatedAt: "2026-05-16T00:00:00.000Z",
        };

        expect(fork.maxContextTokens).toBe(12_000);
        expect(fork.inheritedEventIds).toEqual(["e1", "e2"]);
        expect(fork.parentId).toBeUndefined();
    });
});
