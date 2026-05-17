import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    buildChatResourceSnapshot,
    buildChatTodoSnapshot,
    CHAT_INLINE_SECTIONS,
    CHAT_SCROLL_LOCK_CONTRACT,
    chatChromeLayout,
    NO_PLAN_TEXT,
    renderChatProgressBar,
} from "../src/command/tui/chat/app.tsx";

describe("TUI chat chrome", () => {
    test("matches the single-column performance chat layout contract", () => {
        const layout = chatChromeLayout(160, 50);

        expect(layout.headerBrand).toBe("◉ flyflor-chat");
        expect(layout.sidePanelVisible).toBe(false);
        expect(layout.sidePanelWidth).toBe(0);
        expect(layout.terminalScreenMode).toBe("main-screen");
        expect(layout.usesFixedMessageViewport).toBe(false);
        expect(layout.usesOpenTuiRenderer).toBe(false);
        expect(layout.usesVirtualScrollbar).toBe(false);
        expect(layout.inlineSections).toEqual([
            "Questions",
            "Blackboard",
            "TODO List",
            "MODEL",
            "TOKENS",
            "CONTEXT WINDOW",
        ]);
        expect(layout.inlineSections).toEqual(CHAT_INLINE_SECTIONS);
        expect(layout.sendIconText).toBe(">");
        expect(layout.sendIconText.length).toBe(1);
        expect(layout.inputStatusText).toContain("Enter 发送");
        expect(layout.inputStatusText).toContain("/history");
        expect(layout.inputStatusText).toContain("/exit");
    });

    test("keeps a stable no-plan label for inline todo summaries", () => {
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
            workers: [{ status: "done" }, { status: "running" }, { status: "blocked" }] as never,
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

    test("keeps the single-column layout on narrow terminals", () => {
        const layout = chatChromeLayout(87, 24);

        expect(layout.sidePanelVisible).toBe(false);
        expect(layout.sidePanelWidth).toBe(0);
        expect(layout.terminalScreenMode).toBe("main-screen");
    });

    test("renders model and memory resource bars instead of the old avatar rail", () => {
        const snapshot = buildChatResourceSnapshot({
            activeProject: {
                id: "p1",
                projectDir: "/p",
                projectMemoryDir: "/p/.flyflor/memory",
                title: "Project",
            } as never,
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

    test("uses native terminal scrollback instead of an OpenTUI fixed viewport", async () => {
        const [appSource, entrySource] = await Promise.all([
            readFile(join(import.meta.dir, "../src/command/tui/chat/app.tsx"), "utf8"),
            readFile(join(import.meta.dir, "../src/command/tui/chat/chat.entry.ts"), "utf8"),
        ]);

        expect(CHAT_SCROLL_LOCK_CONTRACT).toMatchObject({
            chatStickyScroll: false,
            chatStickyStart: "native-terminal",
            terminalMouse: false,
            terminalScreenMode: "main-screen",
            wheelRouting: "native-terminal-scrollback",
        });
        expect(appSource).not.toContain("@opentui/core");
        expect(appSource).not.toContain("CliRenderer");
        expect(appSource).not.toContain("createCliRenderer");
        expect(appSource).not.toContain("ScrollBoxRenderable");
        expect(appSource).not.toContain("TextareaRenderable");
        expect(appSource).not.toContain("height: renderer.height");
        expect(appSource).not.toContain("maxHeight");
        expect(appSource).toContain("node:readline/promises");
        expect(appSource).toContain("stdout");
        expect(appSource).not.toContain("onMouseScroll");
        expect(appSource).not.toContain("applyChatScrollWheel");
        expect(appSource).not.toContain("verticalScrollbarOptions");
        expect(appSource).not.toContain("horizontalScrollbarOptions");
        expect(appSource).not.toContain("useDetachedScrollBars(");
        expect(appSource).not.toContain("createVirtualScrollBar(");
        expect(appSource).not.toContain("contentRow.add(sidePanel)");
        expect(appSource).not.toContain("appendConversationSummary(lines)");
        expect(appSource).not.toContain("startSelection");
        expect(appSource).not.toContain("updateSelection");
        expect(appSource).not.toContain("requestSelectionUpdate");
        expect(entrySource).not.toContain("@opentui/core");
        expect(entrySource).not.toContain("createCliRenderer");
        expect(entrySource).not.toContain("withPinnedAlternateScreen(");
        expect(entrySource).not.toContain("useTuiRendererConfig(");
        expect(entrySource).not.toContain("enableMouseMovement: true");
        expect(entrySource).not.toContain("pinRendererAlternateScreen(");
        expect(entrySource).not.toContain("pinTerminalMouseScreen(");
    });
});
