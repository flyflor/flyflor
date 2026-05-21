import { describe, expect, test } from "bun:test";

import {
    STRUCTURED_BLOCKS,
    StructuredBlockProtocol,
    extractStructuredBlocks,
    renderStructuredBlock,
    structuredBlock,
} from "../src/protocol/index.ts";

describe("structured internal protocol blocks", () => {
    test("central registry owns every model-facing block delimiter", () => {
        expect(Object.keys(STRUCTURED_BLOCKS).sort()).toEqual(
            [
                StructuredBlockProtocol.AgentAsk,
                StructuredBlockProtocol.ContextFork,
                StructuredBlockProtocol.ContinuationDecisions,
                StructuredBlockProtocol.IdentityAppend,
                StructuredBlockProtocol.MemoryActions,
                StructuredBlockProtocol.McpCalls,
                StructuredBlockProtocol.ReplayRecord,
                StructuredBlockProtocol.TaskPlan,
            ].sort(),
        );
        expect(structuredBlock(StructuredBlockProtocol.AgentAsk)).toEqual({
            close: "</flyflor_agent_ask>",
            open: "<flyflor_agent_ask>",
            protocol: StructuredBlockProtocol.AgentAsk,
            tag: "flyflor_agent_ask",
        });
        expect(structuredBlock(StructuredBlockProtocol.TaskPlan)).toEqual({
            close: "</flyflor_task_plan>",
            open: "<flyflor_task_plan>",
            protocol: StructuredBlockProtocol.TaskPlan,
            tag: "flyflor_task_plan",
        });
    });

    test("extracts only the requested protocol and preserves visible text", () => {
        const ask = renderStructuredBlock(StructuredBlockProtocol.AgentAsk, {
            reason: "other",
            prompt: "Proceed?",
        });
        const memory = renderStructuredBlock(StructuredBlockProtocol.MemoryActions, []);
        const result = extractStructuredBlocks(`hello\n${ask}\nmiddle\n${memory}\nbye`, StructuredBlockProtocol.AgentAsk);

        expect(result.blocks).toEqual([
            {
                content: JSON.stringify({ reason: "other", prompt: "Proceed?" }),
                protocol: StructuredBlockProtocol.AgentAsk,
            },
        ]);
        expect(result.text).toContain("hello");
        expect(result.text).toContain("middle");
        expect(result.text).toContain("flyflor_memory_actions");
        expect(result.text).toContain("bye");
    });
});
