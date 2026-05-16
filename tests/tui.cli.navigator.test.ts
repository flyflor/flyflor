import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
    listCliTuiPages,
    nextCliTuiPage,
    resolveCommandTuiPage,
    type CliPage,
} from "../src/command/tui/cli/command.route.ts";
import { nextDashboardTab, renderDashboardLines } from "../src/command/tui/index.tsx";
import { filterBlackboardTurns, listWindow, renderDetailLines } from "../src/command/tui/cli/blackboard.browser.tsx";

describe("CLI TUI navigator", () => {
    test("covers the major interactive command pages", () => {
        const pages = listCliTuiPages().map((item) => item.page);
        const expected: CliPage[] = [
            "overview",
            "config",
            "skills",
            "mcp",
            "plugins",
            "sandbox",
            "blackboard",
            "memory",
            "ghosts",
            "dream",
        ];

        expect(pages).toEqual(expected);
    });

    test("returns defensive copies of page metadata", () => {
        const first = listCliTuiPages();
        first[0]!.title = "Changed";

        expect(listCliTuiPages()[0]!.title).toBe("Overview");
    });

    test("maps every automatic command TUI entrypoint to a page", () => {
        const routes: Array<[root: string, sub: string | undefined, page: CliPage | undefined]> = [
            ["status", undefined, "overview"],
            ["channels", undefined, "overview"],
            ["doctor", undefined, "overview"],
            ["config", undefined, "config"],
            ["model", undefined, "config"],
            ["memory", undefined, "memory"],
            ["blackboard", undefined, "blackboard"],
            ["blackboard", "list", undefined],
            ["skills", undefined, "skills"],
            ["mcp", undefined, "mcp"],
            ["sandbox", undefined, "sandbox"],
            ["plugins", undefined, "plugins"],
            ["dream", undefined, "dream"],
            ["setup", undefined, undefined],
            ["gateway", "status", undefined],
            ["chat", undefined, undefined],
            ["tui", undefined, undefined],
        ];

        for (const [root, sub, page] of routes) {
            expect(resolveCommandTuiPage(root, sub)).toBe(page);
        }
    });

    test("moves menu selection within page bounds", () => {
        expect(nextCliTuiPage("overview", -1)).toBe("overview");
        expect(nextCliTuiPage("overview", 1)).toBe("config");
        expect(nextCliTuiPage("dream", 1)).toBe("dream");
        expect(nextCliTuiPage("dream", -1)).toBe("ghosts");
    });

    test("dashboard tab movement wraps and renders every view", () => {
        expect(nextDashboardTab("overview", -1)).toBe("blackboard");
        expect(nextDashboardTab("overview", 1)).toBe("channels");
        expect(nextDashboardTab("blackboard", 1)).toBe("overview");

        const snapshot = {
            blackboardTurns: [],
            config: {
                paths: { home: "/tmp/flyflor" },
                model: { providerId: "openai", model: "gpt-test", apiMode: "chat-completions" },
                sandbox: { mode: "ask" },
                memory: {
                    enabled: true,
                    crystal: { enabled: false, backend: "local" },
                },
            },
            gateway: {
                gatewayRunning: false,
                host: "127.0.0.1",
                port: 3000,
                connectedCount: 0,
                channels: [{ name: "stdio", state: "connected", transport: "local" }],
            },
            loadedAt: "2026-05-16T00:00:00.000Z",
            workingMemory: { status: "ok", detail: "ready" },
            workingRecovery: { status: "ok", detail: "none" },
        };

        expect(renderDashboardLines("overview", snapshot as never).map((line) => line.text)).toContain("◆ Runtime");
        expect(renderDashboardLines("channels", snapshot as never).map((line) => line.text)).toContain("◆ Channels");
        expect(renderDashboardLines("blackboard", snapshot as never).map((line) => line.text)).toContain("◆ Blackboard");
    });

    test("blackboard browser filters, windows and renders details deterministically", () => {
        const turns = [
            { id: "turn-a", status: "converged", projectConstraintId: "p1", goal: "ship alpha", updatedAt: "now" },
            { id: "turn-b", status: "failed", projectConstraintId: "p2", goal: "debug beta", updatedAt: "then" },
        ];

        expect(filterBlackboardTurns(turns as never, "beta").map((turn) => turn.id)).toEqual(["turn-b"]);
        expect(listWindow([1, 2, 3, 4, 5], 3, 2)).toEqual({ items: [3, 4], start: 2 });

        const detailLines = renderDetailLines({
            id: "turn-a",
            status: "converged",
            goal: "ship alpha",
            updatedAt: "now",
            workers: [
                {
                    role: "architect",
                    name: "worker-a",
                    status: "done",
                    stage: "review",
                    handoff: "none",
                    capabilities: ["plan"],
                },
            ],
            steps: [
                {
                    round: 1,
                    worker: "architect",
                    risk: "low",
                    summary: "ok",
                    newFacts: ["fact one"],
                    blockers: ["blocker one"],
                },
            ],
            messages: [{ visibility: "public", round: 1, role: "assistant", createdAt: "now", content: "hello" }],
            decisions: [{ kind: "final", reason: "done", prompt: "choose", options: [{ label: "A" }] }],
        } as never);

        expect(detailLines).toContain("◆ Goal");
        expect(detailLines).toContain("    fact: fact one");
        expect(detailLines).toContain("    blocker: blocker one");
        expect(detailLines).toContain("    option: A");
    });

    test("interactive TUI entrypoints use the shared one-shot lifecycle guard", async () => {
        const files = await Promise.all([
            readFile("src/command/tui/index.tsx", "utf8"),
            readFile("src/command/tui/cli/navigator.ts", "utf8"),
            readFile("src/command/tui/cli/blackboard.browser.tsx", "utf8"),
            readFile("src/command/tui/chat/chat.entry.ts", "utf8"),
        ]);

        for (const source of files) {
            expect(source).toContain("createTuiLifecycle");
            expect(source).not.toContain('process.once("SIGINT"');
            expect(source).not.toContain('process.once("SIGTERM"');
        }
    });

    test("all command TUI surfaces use command renderables instead of Solid rendering", async () => {
        const sources = await Promise.all([
            readFile("src/command/tui/cli/navigator.ts", "utf8"),
            readFile("src/command/tui/index.tsx", "utf8"),
            readFile("src/command/tui/cli/blackboard.browser.tsx", "utf8"),
        ]);

        for (const source of sources) {
            expect(source).toContain("BoxRenderable");
            expect(source).toContain("TextRenderable");
            expect(source).not.toContain("@opentui/solid");
            expect(source).not.toContain("render(()");
        }
    });
});
