export const ProcessRole = {
    Channel: "channel",
    Mcp: "mcp",
    Plugin: "plugin",
    Sandbox: "sandbox",
    Tool: "tool",
} as const;

export type ProcessRole = (typeof ProcessRole)[keyof typeof ProcessRole];

export const ProcessCommand = {
    Crash: "crash",
    Dispatch: "dispatch",
    Heartbeat: "heartbeat",
    Ready: "ready",
    Restart: "restart",
    Result: "result",
    Start: "start",
    Stop: "stop",
} as const;

export type ProcessCommand = (typeof ProcessCommand)[keyof typeof ProcessCommand];

export interface ProcessEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    id: string;
    role: ProcessRole;
    command: ProcessCommand;
    createdAt: string;
    payload: TPayload;
}

export function createEnvelope<TPayload extends Record<string, unknown>>(
    role: ProcessRole,
    command: ProcessCommand,
    payload: TPayload,
): ProcessEnvelope<TPayload> {
    return {
        id: crypto.randomUUID(),
        role,
        command,
        createdAt: new Date().toISOString(),
        payload,
    };
}
