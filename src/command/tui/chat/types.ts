export type Phase = "idle" | "thinking" | "blackboard" | "mcp" | "skill" | "streaming";

export interface McpTrace {
    server: string;
    tool: string;
    ok: boolean;
    resultText: string;
}

export interface BlackboardMeta {
    elapsedMs?: number;
    messages?: number;
    mode: string;
    reason?: string;
    status?: string;
    turnId?: string;
}

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    status: "streaming" | "done" | "error";
    mcpCalls?: McpTrace[];
    skills?: string[];
    blackboard?: BlackboardMeta | null;
    metadata?: Record<string, unknown> | null;
}
