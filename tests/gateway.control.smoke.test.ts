import { describe, expect, test } from "bun:test";

describe("gateway control smoke", () => {
    test("runs the ws thin-client lifecycle including loop pause-resume and history replay", async () => {
        const proc = Bun.spawn(["bun", "run", "scripts/gateway.control.smoke.ts"], {
            stderr: "pipe",
            stdout: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);

        expect(exitCode).toBe(0);
        expect(stderr).toContain('"scope":"socket.module"');
        expect(stderr).toContain('"step":"start.ready"');

        const report = JSON.parse(stdout) as {
            approvedCapabilityEvents: string[];
            approvedCapabilityHistoryMetadata: Array<{
                executiveToolExecutions?: Array<{
                    capabilityKind?: string;
                    key?: string;
                    ok?: boolean;
                    resultSummary?: string;
                }>;
                kind?: string;
                messageId?: string;
            }>;
            approvedCapabilityMetadata: Array<{
                capabilityKind?: string;
                key?: string;
                ok?: boolean;
                resultSummary?: string;
            }>;
            capabilityCommands: string[];
            eventTypes: string[];
            eventPublishTypes: string[];
            finalText: string;
            helloSemanticTypes: string[];
            historyCount: number;
            historyKinds: string[];
            loopSnapshotKind?: string;
            ok: boolean;
            resumedReplyKind?: string;
        };

        expect(report.ok).toBe(true);
        expect(report.capabilityCommands).toContain("builtin.gateway");
        expect(report.helloSemanticTypes).toContain("stream");
        expect(report.loopSnapshotKind).toBe("ask");
        expect(report.resumedReplyKind).toBe("reply");
        expect(report.eventPublishTypes).toEqual(
            expect.arrayContaining([
                "executive.loop.paused",
                "executive.loop.resumed",
            ]),
        );
        expect(report.approvedCapabilityMetadata).toEqual([
            expect.objectContaining({
                capabilityKind: "mcp-tool",
                key: "workspace.read",
                ok: true,
            }),
        ]);
        expect(report.approvedCapabilityMetadata[0]?.resultSummary).toContain("approved capability smoke");
        expect(report.approvedCapabilityEvents).toEqual(expect.arrayContaining(["mcp.tool.call.executed"]));
        expect(report.eventPublishTypes).toEqual(expect.arrayContaining(["mcp.tool.call.executed"]));
        expect(report.approvedCapabilityHistoryMetadata).toEqual([
            expect.objectContaining({
                executiveToolExecutions: [
                    expect.objectContaining({
                        capabilityKind: "mcp-tool",
                        key: "workspace.read",
                        ok: true,
                        resultSummary: expect.stringContaining("approved capability smoke"),
                    }),
                ],
                kind: "reply",
            }),
        ]);
        expect(report.historyCount).toBeGreaterThanOrEqual(2);
        expect(report.historyKinds).toEqual(expect.arrayContaining(["ask", "reply"]));
        expect(report.finalText).toContain("工具调用预算已用完");
        expect(report.eventTypes).toEqual(
            expect.arrayContaining([
                "gateway.start",
                "agent.turn.start",
                "agent.turn.end",
            ]),
        );
    });
});
