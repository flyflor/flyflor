import { describe, expect, test } from "bun:test";
import { parseMemoryActions } from "../src/cognitive/hippocampus/memory/actions/index.ts";

const wrap = (json: string): string => `<agent_memory_update>\n${json}\n</agent_memory_update>`;

describe("LF-R2 codename in MemoryAction", () => {
    test("model-supplied codename normalizes name/workingDir/description", () => {
        const raw = wrap(
            JSON.stringify([
                {
                    action: "add",
                    target: "memory",
                    content: "记下今天关于 fly 的工作",
                    codename: {
                        name: "  fly  ",
                        workingDir: "/Users/x/projects/fly",
                        description: "the flyflor monorepo  workspace ",
                    },
                },
            ]),
        );
        const parsed = parseMemoryActions(raw, 5);
        expect(parsed.actions).toHaveLength(1);
        const cn = parsed.actions[0]!.codename;
        expect(cn).toBeTruthy();
        expect(cn?.name).toBe("fly");
        expect(cn?.workingDir).toBe("/Users/x/projects/fly");
        expect(cn?.description).toBe("the flyflor monorepo workspace");
    });

    test("invalid codename payloads are dropped silently", () => {
        const raw = wrap(
            JSON.stringify([
                { action: "add", target: "memory", content: "no codename here" },
                { action: "add", target: "memory", content: "empty name", codename: { name: "   " } },
                { action: "add", target: "memory", content: "wrong type", codename: "fly" },
            ]),
        );
        const parsed = parseMemoryActions(raw, 5);
        expect(parsed.actions).toHaveLength(3);
        for (const a of parsed.actions) {
            expect(a.codename).toBeUndefined();
        }
    });
});
