import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { BoxRenderable, ScrollBarRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import {
    listCliTuiPages,
    nextCliTuiPage,
    resolveCommandTuiPage,
    type CliPage,
} from "../src/command/tui/cli/command.route.ts";
import { nextDashboardTab, renderDashboardLines } from "../src/command/tui/index.tsx";
import { filterBlackboardTurns, listWindow, renderDetailLines } from "../src/command/tui/cli/blackboard.browser.tsx";
import { useDetachedScrollBars } from "../src/command/tui/scrollbar.composition.ts";
import { withPinnedAlternateScreen } from "../src/command/tui/screen.composition.ts";

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
        expect(renderDashboardLines("blackboard", snapshot as never).map((line) => line.text)).toContain(
            "◆ Blackboard",
        );
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

    test("command TUI scrollboxes do not render built-in scrollbars", async () => {
        const sources = await Promise.all([
            readFile("src/command/tui/cli/navigator.ts", "utf8"),
            readFile("src/command/tui/index.tsx", "utf8"),
        ]);
        const composition = await readFile("src/command/tui/scrollbar.composition.ts", "utf8");

        for (const source of sources) {
            expect(source).toContain("const SHOW_SCROLLBARS = false");
            expect(source).toContain("withPinnedAlternateScreen(");
            expect(source).toContain("pinRendererAlternateScreen(instance)");
            expect(source).toContain("useDetachedScrollBars(");
            expect(source).not.toMatch(/verticalScrollBar\.visible\s*=\s*true/u);
            expect(source).not.toMatch(/visible:\s*true,\s*\n\s*width:\s*2/u);
        }
        expect(composition).toContain("BoxRenderable.prototype.remove.call(scrollBox, scrollBox.verticalScrollBar.id)");
    });

    test("detaches scrollbox scrollbar renderables at runtime", async () => {
        const testRenderer = await createTestRenderer({
            width: 24,
            height: 8,
            screenMode: "alternate-screen",
        });

        try {
            const scrollBox = new ScrollBoxRenderable(testRenderer.renderer, {
                flexGrow: 1,
                flexShrink: 1,
                contentOptions: {
                    flexDirection: "column",
                },
                horizontalScrollbarOptions: {
                    visible: false,
                    height: 0,
                },
                verticalScrollbarOptions: {
                    visible: false,
                    width: 0,
                    showArrows: false,
                },
            });
            useDetachedScrollBars(scrollBox);
            testRenderer.renderer.root.add(scrollBox);

            for (let index = 0; index < 20; index += 1) {
                scrollBox.content.add(new TextRenderable(testRenderer.renderer, { content: `line ${index}` }));
            }

            await testRenderer.renderOnce();

            const directChildren = BoxRenderable.prototype.getChildren.call(scrollBox) as unknown[];
            expect(directChildren.some((child) => child instanceof ScrollBarRenderable)).toBe(false);
            expect(scrollBox.wrapper.getChildren().some((child) => child instanceof ScrollBarRenderable)).toBe(false);
            expect(scrollBox.verticalScrollBar.parent).toBeNull();
            expect(scrollBox.horizontalScrollBar.parent).toBeNull();
            expect(testRenderer.captureCharFrame()).not.toContain("▌");
        } finally {
            testRenderer.renderer.destroy();
        }
    });

    test("pins OpenTUI to alternate screen while creating renderers", async () => {
        const previous = process.env.OTUI_USE_ALTERNATE_SCREEN;
        process.env.OTUI_USE_ALTERNATE_SCREEN = "0";

        try {
            let observedDuringCreate = "";
            const result = await withPinnedAlternateScreen(
                async () => {
                    observedDuringCreate = String(process.env.OTUI_USE_ALTERNATE_SCREEN ?? "");
                    return "ok";
                },
                () => {},
            );

            expect(result).toBe("ok");
            expect(observedDuringCreate).toBe("1");
            expect(process.env.OTUI_USE_ALTERNATE_SCREEN).toBe("0");
        } finally {
            if (previous === undefined) {
                delete process.env.OTUI_USE_ALTERNATE_SCREEN;
            } else {
                process.env.OTUI_USE_ALTERNATE_SCREEN = previous;
            }
        }
    });
});
