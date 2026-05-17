import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { BoxRenderable, RGBA, ScrollBarRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import {
    listCliTuiPages,
    nextCliTuiPage,
    resolveCommandTuiPage,
    type CliPage,
} from "../src/command/tui/cli/command.route.ts";
import { nextDashboardTab, renderDashboardLines } from "../src/command/tui/index.tsx";
import { filterBlackboardTurns, listWindow, renderDetailLines } from "../src/command/tui/cli/blackboard.browser.tsx";
import { createVirtualScrollBar, useDetachedScrollBars } from "../src/command/tui/scrollbar.composition.ts";
import {
    pinTerminalMouseScreen,
    useTuiTerminalEnvironment,
    withPinnedAlternateScreen,
} from "../src/command/tui/screen.composition.ts";

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
            const virtualScrollBar = createVirtualScrollBar(testRenderer.renderer, scrollBox, {
                thumbColor: RGBA.fromInts(255, 151, 190),
                trackColor: RGBA.fromInts(76, 106, 126),
            });
            const row = new BoxRenderable(testRenderer.renderer, {
                flexDirection: "row",
                height: 8,
                width: 24,
            });
            row.add(scrollBox);
            row.add(virtualScrollBar.rail);
            testRenderer.renderer.root.add(row);

            for (let index = 0; index < 20; index += 1) {
                scrollBox.content.add(new TextRenderable(testRenderer.renderer, { content: `line ${index}` }));
            }

            await testRenderer.renderOnce();
            virtualScrollBar.sync();
            await testRenderer.renderOnce();

            const directChildren = BoxRenderable.prototype.getChildren.call(scrollBox) as unknown[];
            expect(directChildren.some((child) => child instanceof ScrollBarRenderable)).toBe(false);
            expect(scrollBox.wrapper.getChildren().some((child) => child instanceof ScrollBarRenderable)).toBe(false);
            expect(scrollBox.verticalScrollBar.parent).toBeNull();
            expect(scrollBox.horizontalScrollBar.parent).toBeNull();
            expect(testRenderer.captureCharFrame()).toContain("█");
        } finally {
            testRenderer.renderer.destroy();
        }
    });

    test("routes wheel events into detached scrollboxes and keeps the virtual rail visible", async () => {
        const testRenderer = await createTestRenderer({
            width: 24,
            height: 8,
            screenMode: "alternate-screen",
        });

        try {
            const scrollBox = new ScrollBoxRenderable(testRenderer.renderer, {
                contentOptions: {
                    flexDirection: "column",
                },
                flexGrow: 1,
                flexShrink: 1,
                horizontalScrollbarOptions: {
                    height: 0,
                    visible: false,
                },
                verticalScrollbarOptions: {
                    showArrows: false,
                    visible: false,
                    width: 0,
                },
            });
            useDetachedScrollBars(scrollBox);
            const virtualScrollBar = createVirtualScrollBar(testRenderer.renderer, scrollBox, {
                thumbColor: RGBA.fromInts(255, 151, 190),
                trackColor: RGBA.fromInts(76, 106, 126),
            });
            const row = new BoxRenderable(testRenderer.renderer, {
                flexDirection: "row",
                height: 8,
                width: 24,
            });
            row.add(scrollBox);
            row.add(virtualScrollBar.rail);
            testRenderer.renderer.root.add(row);

            for (let index = 0; index < 30; index += 1) {
                scrollBox.content.add(new TextRenderable(testRenderer.renderer, { content: `line ${index}` }));
            }

            await testRenderer.renderOnce();
            virtualScrollBar.sync();
            await testRenderer.mockMouse.scroll(2, 2, "down");
            await testRenderer.renderOnce();
            virtualScrollBar.sync();

            expect(scrollBox.scrollTop).toBeGreaterThan(0);
            expect(testRenderer.captureCharFrame()).toContain("█");
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

    test("pins terminal alternate screen without duplicating OpenTUI mouse tracking", () => {
        const writes: string[] = [];
        const restore = pinTerminalMouseScreen({
            isTTY: true,
            write: (chunk: string) => {
                writes.push(chunk);
                return true;
            },
        } as never);

        restore();

        expect(writes[0]).toContain("\x1b[?1049h");
        expect(writes[0]).toContain("\x1b[3J");
        expect(writes[0]).not.toContain("\x1b[?1003h");
        expect(writes[0]).not.toContain("\x1b[?1006h");
        expect(writes[1]).toContain("\x1b[?1049l");
        expect(writes[1]).not.toContain("\x1b[?1003l");
        expect(writes[1]).not.toContain("\x1b[?1006l");
    });

    test("normalizes iTerm2 color env only when the shell omits color capability", () => {
        const env: NodeJS.ProcessEnv = { TERM: "xterm-256color", TERM_PROGRAM: "iTerm.app" };
        const restore = useTuiTerminalEnvironment(env);
        expect(env.COLORTERM).toBe("truecolor");
        restore();
        expect(env.COLORTERM).toBeUndefined();

        const explicitEnv: NodeJS.ProcessEnv = { COLORTERM: "24bit", TERM_PROGRAM: "iTerm.app" };
        const restoreExplicit = useTuiTerminalEnvironment(explicitEnv);
        expect(explicitEnv.COLORTERM).toBe("24bit");
        restoreExplicit();
        expect(explicitEnv.COLORTERM).toBe("24bit");
    });
});
