/**
 * Internal model-facing structured block protocol.
 *
 * Flyflor uses lightweight tagged JSON blocks instead of XML:
 *
 * <flyflor_protocol_name>
 * {"json":"payload"}
 * </flyflor_protocol_name>
 *
 * This file is the single registry for block delimiters. Feature modules own
 * their payload validation, but they must not hand-write protocol tags.
 */

export const StructuredBlockProtocol = {
    AgentAsk: "agentAsk",
    ContextFork: "contextFork",
    ContinuationDecisions: "continuationDecisions",
    IdentityAppend: "identityAppend",
    MemoryActions: "memoryActions",
    McpCalls: "mcpCalls",
    ReplayRecord: "replayRecord",
    TaskPlan: "taskPlan",
} as const;

export type StructuredBlockProtocol = (typeof StructuredBlockProtocol)[keyof typeof StructuredBlockProtocol];

export interface StructuredBlockDefinition {
    close: string;
    open: string;
    protocol: StructuredBlockProtocol;
    tag: string;
}

const STRUCTURED_BLOCK_TAGS: Record<StructuredBlockProtocol, string> = {
    // 新增模型可输出的内部协议块时先登记在这里，再由业务模块挂自己的 JSON 校验器。
    // 这样 tag 拼写、边界符和剥离行为只有一个来源，避免不同模块写出互不兼容的坏数据。
    [StructuredBlockProtocol.AgentAsk]: "flyflor_agent_ask",
    [StructuredBlockProtocol.ContextFork]: "flyflor_context_fork",
    [StructuredBlockProtocol.ContinuationDecisions]: "flyflor_continuation_decisions",
    [StructuredBlockProtocol.IdentityAppend]: "flyflor_identity_append",
    [StructuredBlockProtocol.MemoryActions]: "flyflor_memory_actions",
    [StructuredBlockProtocol.McpCalls]: "flyflor_mcp_calls",
    [StructuredBlockProtocol.ReplayRecord]: "flyflor_replay_record",
    [StructuredBlockProtocol.TaskPlan]: "flyflor_task_plan",
};

export const STRUCTURED_BLOCKS: Record<StructuredBlockProtocol, StructuredBlockDefinition> = Object.fromEntries(
    Object.entries(STRUCTURED_BLOCK_TAGS).map(([protocol, tag]) => [
        protocol,
        {
            close: `</${tag}>`,
            open: `<${tag}>`,
            protocol: protocol as StructuredBlockProtocol,
            tag,
        },
    ]),
) as Record<StructuredBlockProtocol, StructuredBlockDefinition>;

export interface ExtractedStructuredBlock {
    content: string;
    protocol: StructuredBlockProtocol;
}

export interface ExtractStructuredBlocksResult {
    blocks: ExtractedStructuredBlock[];
    text: string;
}

export function structuredBlock(protocol: StructuredBlockProtocol): StructuredBlockDefinition {
    return STRUCTURED_BLOCKS[protocol];
}

export function renderStructuredBlock(protocol: StructuredBlockProtocol, payload: unknown): string {
    const block = structuredBlock(protocol);
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    return `${block.open}\n${body}\n${block.close}`;
}

export function extractStructuredBlocks(
    rawText: string,
    protocol: StructuredBlockProtocol,
): ExtractStructuredBlocksResult {
    const block = structuredBlock(protocol);
    const blocks: ExtractedStructuredBlock[] = [];
    const visible: string[] = [];
    let cursor = 0;

    // 这里只识别固定协议边界，不读取 payload 的业务语义；payload 的 JSON schema 由调用方校验。
    while (cursor < rawText.length) {
        const start = rawText.indexOf(block.open, cursor);
        if (start < 0) {
            visible.push(rawText.slice(cursor));
            break;
        }
        visible.push(rawText.slice(cursor, start));
        const contentStart = start + block.open.length;
        const end = rawText.indexOf(block.close, contentStart);
        if (end < 0) {
            visible.push(rawText.slice(start));
            break;
        }
        blocks.push({
            content: rawText.slice(contentStart, end).trim(),
            protocol,
        });
        cursor = end + block.close.length;
    }

    return {
        blocks,
        text: visible.join("").trim(),
    };
}

export function parseStructuredJson(rawJson: string): unknown {
    return JSON.parse(rawJson.trim()) as unknown;
}
