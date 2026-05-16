import { describe, expect, test } from "bun:test";
import { buildChatTodoSnapshot, chatChromeLayout, NO_PLAN_TEXT } from "../src/command/tui/chat/app.tsx";

describe("TUI chat chrome", () => {
    test("matches the screenshot-style chat layout contract", () => {
        const layout = chatChromeLayout(160, 50);

        expect(layout.headerBrand).toBe("◉ flyflor-chat · powered by OpenTUI");
        expect(layout.defaultSidePanelMode).toBe("blackboard");
        expect(layout.sidePanelVisible).toBe(true);
        expect(layout.sidePanelWidth).toBe(44);
        expect(layout.avatarHeight).toBe(14);
        expect(layout.todoPanelHeight).toBe(9);
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
        expect(layout.avatarHeight).toBe(6);
        expect(layout.todoPanelHeight).toBe(6);
    });
});
