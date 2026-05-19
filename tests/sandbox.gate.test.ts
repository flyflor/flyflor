/**
 * gateCapabilityExecution 边界测试。
 *
 * 这是 sandbox 的统一执行闸门：plugin / shell-hook / MCP tool 都通过它发布
 * SandboxToolDenied / SandboxToolApprovalRequested / SandboxToolApprovalDenied 事件。
 * 任何后续新增的可执行能力都应该走这个闸门，否则审计 sink 会有盲区。
 */
import { describe, expect, test } from "bun:test";
import { gateCapabilityExecution } from "../src/agent/sandbox/index.ts";
import {
    CapabilityExecutionKind,
    SandboxMode,
    ToolApprovalMode,
    type RuntimeEvent,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import type { SandboxPolicy } from "../src/agent/sandbox/index.ts";

class CapturingEvents implements EventSink {
    public readonly events: RuntimeEvent[] = [];
    public publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
    public types(): string[] {
        return this.events.map((e) => e.type);
    }
}

function policy(approval: ToolApprovalMode): SandboxPolicy {
    return {
        mode: SandboxMode.Off,
        approvals: {
            [CapabilityExecutionKind.Computer]: approval,
            [CapabilityExecutionKind.McpTool]: approval,
            [CapabilityExecutionKind.Plugin]: approval,
            [CapabilityExecutionKind.ShellHook]: approval,
        },
        computerApproval: approval,
        mcpToolApproval: approval,
        pluginApproval: approval,
        shellHookApproval: approval,
        canExecuteTools: approval !== ToolApprovalMode.Deny,
        requiresApproval: approval === ToolApprovalMode.Ask,
        summary: "test",
    };
}

describe("gateCapabilityExecution", () => {
    test("preDeny 立即上报 SandboxToolDenied 并拒绝", async () => {
        const events = new CapturingEvents();
        const result = await gateCapabilityExecution({
            policy: policy(ToolApprovalMode.Allow),
            kind: CapabilityExecutionKind.McpTool,
            events,
            descriptor: { server: "x", tool: "y" },
            preDeny: { reason: "tool-not-in-catalog", message: "missing" },
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("missing");
        expect(events.types()).toEqual([RuntimeEventType.SandboxToolDenied]);
        expect(events.events[0]?.payload).toMatchObject({
            reason: "tool-not-in-catalog",
            kind: CapabilityExecutionKind.McpTool,
            server: "x",
            tool: "y",
        });
    });

    test("策略禁止时上报 SandboxToolDenied", async () => {
        const events = new CapturingEvents();
        const result = await gateCapabilityExecution({
            policy: policy(ToolApprovalMode.Deny),
            kind: CapabilityExecutionKind.Plugin,
            events,
            descriptor: { plugin: "p" },
        });
        expect(result.allowed).toBe(false);
        expect(events.types()).toEqual([RuntimeEventType.SandboxToolDenied]);
        expect(events.events[0]?.payload).toMatchObject({ kind: CapabilityExecutionKind.Plugin });
    });

    test("Ask 模式下无 approver 视为未批准", async () => {
        const events = new CapturingEvents();
        const result = await gateCapabilityExecution({
            policy: policy(ToolApprovalMode.Ask),
            kind: CapabilityExecutionKind.ShellHook,
            events,
            descriptor: { hook: "h" },
        });
        expect(result.allowed).toBe(false);
        expect(events.types()).toEqual([
            RuntimeEventType.SandboxToolApprovalRequested,
            RuntimeEventType.SandboxToolApprovalDenied,
        ]);
    });

    test("Ask 模式下 approver 返回 true 放行，仅发起 Requested 事件", async () => {
        const events = new CapturingEvents();
        const result = await gateCapabilityExecution({
            policy: policy(ToolApprovalMode.Ask),
            kind: CapabilityExecutionKind.ShellHook,
            events,
            descriptor: { hook: "h" },
            approve: () => true,
        });
        expect(result.allowed).toBe(true);
        expect(events.types()).toEqual([RuntimeEventType.SandboxToolApprovalRequested]);
    });

    test("approver 抛错会拒绝执行并暴露审批错误", async () => {
        const events = new CapturingEvents();
        const result = await gateCapabilityExecution({
            policy: policy(ToolApprovalMode.Ask),
            kind: CapabilityExecutionKind.McpTool,
            events,
            descriptor: { server: "s", tool: "t" },
            approve: () => {
                throw new Error("boom");
            },
            deniedMessage: "denied-by-test",
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(`${CapabilityExecutionKind.McpTool} approval failed: boom`);
        expect(events.types()).toEqual([
            RuntimeEventType.SandboxToolApprovalRequested,
            RuntimeEventType.SandboxToolApprovalDenied,
        ]);
        expect(events.events[1]?.payload).toMatchObject({
            approvalError: "boom",
            reason: "approval-error",
            server: "s",
            tool: "t",
        });
    });

    test("Allow 直接放行不发任何 sandbox 事件", async () => {
        const events = new CapturingEvents();
        const result = await gateCapabilityExecution({
            policy: policy(ToolApprovalMode.Allow),
            kind: CapabilityExecutionKind.McpTool,
            events,
            descriptor: { server: "s", tool: "t" },
        });
        expect(result.allowed).toBe(true);
        expect(events.events).toHaveLength(0);
    });

    test("computer capability uses its own approval surface", async () => {
        const events = new CapturingEvents();
        const result = await gateCapabilityExecution({
            policy: policy(ToolApprovalMode.Ask),
            kind: CapabilityExecutionKind.Computer,
            events,
            descriptor: { capability: "computer.click" },
            approve: () => true,
        });
        expect(result.allowed).toBe(true);
        expect(events.types()).toEqual([RuntimeEventType.SandboxToolApprovalRequested]);
        expect(events.events[0]?.payload).toMatchObject({
            kind: CapabilityExecutionKind.Computer,
            capability: "computer.click",
        });
    });
});
