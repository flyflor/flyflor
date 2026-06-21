export type ToolRisk = 'interaction' | 'read' | 'write' | 'destructive' | 'external';

export interface ToolMetadata {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    risk: ToolRisk;
}

export interface ToolEffect {
    type: 'ask' | 'confirm' | 'read' | 'write' | 'delete' | 'execute';
    path?: string;
}

export interface ToolError {
    code: string;
    message: string;
    detail?: unknown;
}

export type ToolResult<T = unknown> =
    | { ok: true; data: T; effects?: readonly ToolEffect[] }
    | { ok: false; error: ToolError; effects?: readonly ToolEffect[] };
