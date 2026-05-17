import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    buildChatResourceSnapshot,
    buildChatTodoSnapshot,
    CHAT_SIDE_PANEL_SECTIONS,
    CHAT_SCROLL_LOCK_CONTRACT,
    chatChromeLayout,
    NO_PLAN_TEXT,
    renderChatProgressBar,
} from "../src/command/tui/chat/app.tsx";

describe("TUI chat chrome", () => {
    test("matches the screenshot-style chat layout contract", () => {
        const layout = chatChromeLayout(160, 50);

        expect(layout.headerBrand).toBe("◉ flyflor-chat · powered by OpenTUI");
        expect(layout.defaultSidePanelMode).toBe("blackboard");
        expect(layout.sidePanelVisible).toBe(true);
        expect(layout.sidePanelWidth).toBe(44);
        expect(layout.metricsPanelHeight).toBe(13);
        expect(layout.todoPanelHeight).toBe(12);
        expect(CHAT_SIDE_PANEL_SECTIONS).toEqual([
            "Questions",
            "Blackboard",
            "TODO List",
            "MODEL",
            "TOKENS",
            "CONTEXT WINDOW",
        ]);
        expect(layout.sendIconText).toBe("➤➤➤");
        expect(layout.sendIconText.length).toBeGreaterThanOrEqual(3);
        expect(layout.inputStatusText).toContain("Enter 发送");
        expect(layout.inputStatusText).toContain("Cmd/Ctrl+C 复制");
    });

    test("keeps a stable no-plan label for the todo rail", () => {
        const snapshot = buildChatTodoSnapshot(undefined);

        expect(NO_PLAN_TEXT).toBe("暂无计划");
        expect(snapshot.progressLine).toBe("no todo list yet");
        expect(snapshot.stepCount).toBe(0);
        expect(snapshot.workstreamCount).toBe(0);
    });

    test("renders todo progress from blackboard workstreams and steps", () => {
        const snapshot = buildChatTodoSnapshot({
            budget: { maxRounds: 8 } as never,
            metadata: {
                blackboardPlan: {
                    workstreams: ["analysis: define scope", "review: verify reply"],
                },
            } as never,
            steps: [
                { round: 1, workerRole: "architect", outputSummary: "shape the plan" },
                { round: 2, workerRole: "reviewer", outputSummary: "check the edge cases" },
            ] as never,
            workers: [
                { status: "done" },
                { status: "running" },
                { status: "blocked" },
            ] as never,
        } as never);

        expect(snapshot.progressLine).toContain("progress 2/8 rounds");
        expect(snapshot.progressLine).toContain("workers 1/3");
        expect(snapshot.workerLine).toContain("1 done");
        expect(snapshot.workerLine).toContain("1 running");
        expect(snapshot.workerLine).toContain("1 blocked");
        expect(snapshot.workstreamCount).toBe(2);
        expect(snapshot.workstreams).toEqual(["analysis: define scope", "review: verify reply"]);
        expect(snapshot.steps[0]).toContain("r1 architect");
        expect(snapshot.steps[1]).toContain("r2 reviewer");
    });

    test("hides the right visual rail on narrow terminals", () => {
        const layout = chatChromeLayout(87, 24);

        expect(layout.sidePanelVisible).toBe(false);
        expect(layout.sidePanelWidth).toBe(0);
        expect(layout.metricsPanelHeight).toBe(12);
        expect(layout.todoPanelHeight).toBe(8);
    });

    test("renders model and memory resource bars instead of the old avatar rail", () => {
        const snapshot = buildChatResourceSnapshot({
            activeProject: { id: "p1", projectDir: "/p", projectMemoryDir: "/p/.flyflor/memory", title: "Project" } as never,
            contextRingSize: 12,
            identityAppendDailyLimit: 3,
            maxOutputTokens: 100,
            memoryVisibilityThreshold: 0.65,
            model: "test-model",
            providerId: "test-provider",
            questionText: "12345678",
            reply: {
                id: "a1",
                role: "assistant",
                content: "123456789012",
                status: "done",
                metadata: { memoryActions: 1 },
            },
            turnCount: 2,
        });

        expect(snapshot.modelLine).toBe("test-provider · test-model");
        expect(snapshot.memoryLine).toContain("actions 1");
        expect(snapshot.memoryLine).toContain("project on");
        expect(snapshot.tokens).toEqual({
            draft: 0,
            input: 2,
            output: 3,
            total: 5,
        });
        expect(snapshot.contextWindow.usedLabel).toBe("5 / 100");
        expect(snapshot.metrics.map((metric) => metric.label)).toEqual([
            "context",
            "reply",
            "draft",
            "memory",
            "recall",
            "write",
        ]);
        expect(snapshot.metrics.find((metric) => metric.label === "recall")?.value).toBe("gate 0.65");
        expect(renderChatProgressBar(0.5, 4)).toBe("██░░ 50%");
    });

    test("keeps stream panels locked to OpenTUI scrollboxes", async () => {
        const [appSource, entrySource] = await Promise.all([
            readFile(join(import.meta.dir, "../src/command/tui/chat/app.tsx"), "utf8"),
            readFile(join(import.meta.dir, "../src/command/tui/chat/chat.entry.ts"), "utf8"),
        ]);

        expect(CHAT_SCROLL_LOCK_CONTRACT).toMatchObject({
            chatStickyScroll: true,
            chatStickyStart: "bottom",
            hiddenScrollbarSize: 0,
            showScrollbars: false,
            sidePanelStickyScroll: true,
            sidePanelStickyStart: "bottom",
            terminalMouse: true,
            terminalScreenMode: "alternate-screen",
            wheelRouting: "opentui-scrollbox",
        });
        expect(appSource).not.toContain("onMouseScroll");
        expect(appSource).not.toContain("applyChatScrollWheel");
        expect(appSource).not.toMatch(/verticalScrollBar\.visible\s*=\s*true/u);
        expect(appSource).toContain("stickyScroll: CHAT_SCROLL_LOCK_CONTRACT.sidePanelStickyScroll");
        expect(appSource).toContain("visible: CHAT_SCROLL_LOCK_CONTRACT.showScrollbars");
        expect(appSource).toContain("useDetachedScrollBars(scrollBox)");
        expect(appSource).toContain("createVirtualScrollBar(renderer, scrollBox");
        expect(appSource).not.toContain("createVirtualScrollBar(renderer, todoScrollBox");
        expect(appSource).not.toContain("createVirtualScrollBar(renderer, detailScrollBox");
        expect(appSource).not.toContain("appendConversationSummary(lines)");
        expect(entrySource).toContain("withPinnedAlternateScreen(");
        expect(entrySource).toContain("useTuiRendererConfig({");
        expect(entrySource).not.toContain("enableMouseMovement: true");
        expect(entrySource).toContain("pinRendererAlternateScreen(instance)");
        expect(entrySource).toContain("pinTerminalMouseScreen()");
        expect(await readFile(join(import.meta.dir, "../src/command/tui/scrollbar.composition.ts"), "utf8")).toContain(
            "BoxRenderable.prototype.remove.call(scrollBox, scrollBox.verticalScrollBar.id)",
        );
        const screenSource = await readFile(join(import.meta.dir, "../src/command/tui/screen.composition.ts"), "utf8");
        expect(screenSource).toContain("\\x1b[3J");
        expect(screenSource).not.toContain("\\x1b[?1003h");
        expect(screenSource).toContain("\\x1b[?1049l");
    });
});
