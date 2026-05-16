import { describe, expect, test } from "bun:test";
import { coalesceChatInput } from "../src/agent/runtime/chat.ts";

describe("Human chat input boundary", () => {
    test("chat entrypoints warm runtime before first turn", async () => {
        const humanChatSource = await Bun.file("src/agent/runtime/chat.ts").text();
        const tuiChatSource = await Bun.file("src/command/tui/chat/chat.entry.ts").text();
        const commandSource = await Bun.file("src/command/cli/commands.ts").text();

        expect(humanChatSource).toContain("await runtime.warmup()");
        expect(tuiChatSource).toContain("await options.runtime.warmup()");
        expect(commandSource).toContain("await runtime.warmup()");
    });

    test("coalesces pasted multiline content into one turn before /exit", async () => {
        const inputs = await collect(
            coalesceChatInput(
                lines([
                    "任务：写一首 14 行诗",
                    "",
                    "Planner 任务：",
                    "每一轮必须尝试全新意象",
                    "",
                    "Reviewer 任务：",
                    "必须指出具体瑕疵",
                    "/exit",
                ]),
                10,
            ),
        );

        expect(inputs).toHaveLength(1);
        expect(inputs[0]).toMatchObject({
            exitAfter: true,
            text: [
                "任务：写一首 14 行诗",
                "",
                "Planner 任务：",
                "每一轮必须尝试全新意象",
                "",
                "Reviewer 任务：",
                "必须指出具体瑕疵",
            ].join("\n"),
        });
    });

    test("keeps slow manually typed lines as separate turns", async () => {
        const inputs = await collect(coalesceChatInput(delayedLines(["第一句", "第二句"], 5), 1));

        expect(inputs.map((input) => input.text)).toEqual(["第一句", "第二句"]);
    });
});

async function collect<TValue>(source: AsyncIterable<TValue>): Promise<TValue[]> {
    const result: TValue[] = [];
    for await (const item of source) {
        result.push(item);
    }
    return result;
}

async function* lines(values: string[]): AsyncGenerator<string> {
    for (const value of values) {
        yield value;
    }
}

async function* delayedLines(values: string[], delayMs: number): AsyncGenerator<string> {
    for (const value of values) {
        yield value;
        await Bun.sleep(delayMs);
    }
}
