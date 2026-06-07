export interface InvestigationToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export type InvestigationObserveKind =
    | 'file'
    | 'files'
    | 'search'
    | 'status'
    | 'code_symbol'
    | 'code_relation'
    | 'code_impact'
    | 'code_affected';

export interface InvestigationObserveRequest {
    goal: string;
    kind: InvestigationObserveKind;
    query?: string;
    path?: string;
    symbol?: string;
    relation?: 'callers' | 'callees';
    caseSensitive?: boolean;
    maxMatches?: number;
    maxBytes?: number;
    timeoutMs?: number;
    pipes?: string[];
}

export interface InvestigationObservation {
    ok: boolean;
    source: string;
    pipes: string[];
    code: string;
    summary: string;
    evidence: string[];
    data?: unknown;
    error?: string;
    truncated?: boolean;
}

export type InvestigationToolObservation = InvestigationObservation;

export interface InvestigationObserveContext {
    rootPath: string;
}

export interface InvestigationSourcePlugin {
    readonly definition: InvestigationToolDefinition;
    canObserve(request: InvestigationObserveRequest): boolean;
    observe(request: InvestigationObserveRequest, context: InvestigationObserveContext): Promise<InvestigationObservation>;
}

export interface InvestigationPipePlugin {
    readonly name: string;
    canPipe(request: InvestigationObserveRequest, context: InvestigationObserveContext): boolean;
    pipeObservation(
        next: () => Promise<InvestigationObservation>,
        request: InvestigationObserveRequest,
        context: InvestigationObserveContext,
    ): Promise<InvestigationObservation>;
}

export interface WorkspaceToolInput {
    path?: unknown;
    pattern?: unknown;
    query?: unknown;
    include?: unknown;
    caseSensitive?: unknown;
    maxMatches?: unknown;
    maxBytes?: unknown;
    args?: unknown;
    timeoutMs?: unknown;
}
