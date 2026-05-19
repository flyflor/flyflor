import { describe, expect, test } from "bun:test";
import {
    SandboxQuotaTracker,
    gateCapabilityExecution,
    createSandboxPolicy,
} from "../src/agent/sandbox/index.ts";
import {
    CapabilityExecutionKind,
    SandboxMode,
    ToolApprovalMode,
} from "../src/protocol/contracts/index.ts";
import type { EventSink } from "../src/events/index.ts";

function silentEvents(): EventSink {
    return { publish() {} };
}

describe("SandboxQuotaTracker", () => {
    test("perKindPerRequest blocks the (N+1)-th allow", () => {
        const tracker = new SandboxQuotaTracker({ perKindPerRequest: 2 });
        for (let i = 0; i < 2; i++) {
            const check = tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "req1", { yolo: false });
            expect(check.ok).toBe(true);
            tracker.recordAllow(CapabilityExecutionKind.McpTool, "req1", { yolo: false });
        }
        const third = tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "req1", { yolo: false });
        expect(third.ok).toBe(false);
        expect(third.reason).toBe("quota-exceeded");
    });

    test("counts are per-request and per-kind", () => {
        const tracker = new SandboxQuotaTracker({ perKindPerRequest: 1 });
        tracker.recordAllow(CapabilityExecutionKind.McpTool, "req1", { yolo: false });
        // Different request: fresh budget.
        expect(
            tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "req2", { yolo: false }).ok,
        ).toBe(true);
        // Different kind, same request: fresh budget.
        expect(
            tracker.checkBeforeAllow(CapabilityExecutionKind.Plugin, "req1", { yolo: false }).ok,
        ).toBe(true);
        expect(
            tracker.checkBeforeAllow(CapabilityExecutionKind.Computer, "req1", { yolo: false }).ok,
        ).toBe(true);
    });

    test("forgetRequest releases counters", () => {
        const tracker = new SandboxQuotaTracker({ perKindPerRequest: 1 });
        tracker.recordAllow(CapabilityExecutionKind.McpTool, "req1", { yolo: false });
        expect(tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "req1", { yolo: false }).ok).toBe(false);
        tracker.forgetRequest("req1");
        expect(tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "req1", { yolo: false }).ok).toBe(true);
    });

    test("YOLO cooldown blocks rapid allows", () => {
        let t = 1000;
        const tracker = new SandboxQuotaTracker({ yoloCooldownMs: 500, now: () => t });
        // No previous yolo allow → ok.
        expect(tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "r", { yolo: true }).ok).toBe(true);
        tracker.recordAllow(CapabilityExecutionKind.McpTool, "r", { yolo: true });
        // Same kind 200ms later → blocked.
        t = 1200;
        const blocked = tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "r", { yolo: true });
        expect(blocked.ok).toBe(false);
        expect(blocked.reason).toBe("yolo-cooldown");
        // 600ms later → ok.
        t = 1700;
        expect(tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "r", { yolo: true }).ok).toBe(true);
    });

    test("cooldown does not apply to non-yolo allows", () => {
        let t = 1000;
        const tracker = new SandboxQuotaTracker({ yoloCooldownMs: 500, now: () => t });
        tracker.recordAllow(CapabilityExecutionKind.McpTool, "r", { yolo: true });
        t = 1100;
        expect(tracker.checkBeforeAllow(CapabilityExecutionKind.McpTool, "r", { yolo: false }).ok).toBe(true);
    });
});

describe("gateCapabilityExecution with quota", () => {
    test("returns blocked with reason when quota exceeded", async () => {
        const policy = createSandboxPolicy({
            mode: SandboxMode.Yolo,
            mcpToolApproval: ToolApprovalMode.Allow,
        });
        const tracker = new SandboxQuotaTracker({ perKindPerRequest: 1 });
        const first = await gateCapabilityExecution({
            policy,
            kind: CapabilityExecutionKind.McpTool,
            events: silentEvents(),
            requestId: "req1",
            descriptor: { server: "s", tool: "t" },
            quota: tracker,
        });
        expect(first.allowed).toBe(true);
        const second = await gateCapabilityExecution({
            policy,
            kind: CapabilityExecutionKind.McpTool,
            events: silentEvents(),
            requestId: "req1",
            descriptor: { server: "s", tool: "t" },
            quota: tracker,
        });
        expect(second.allowed).toBe(false);
        expect(second.reason).toContain("quota");
    });
});
