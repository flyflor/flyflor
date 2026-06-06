import { type FModelConfiguration, type FModelProtocolConfiguration, FModelProtocolName } from '@/config';

/**
 * Roles accepted by provider chat protocols.
 * These values are provider protocol strings, not Flyflor context section names.
 */
export enum AgentChatRole {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
}

/**
 * One message sent to the configured LLM provider.
 * `role` is the provider protocol role; `content` is the text payload for that message.
 */
export interface AgentChatMessage {
    role: AgentChatRole;
    content: string;
}

export interface IntelligenceRequest {
    llm: FModelConfiguration;
    modelOverride?: string;
    maxTokens?: number;
}

export interface IntelligenceTurn {
    read(): Promise<{ done: boolean; value?: string }>;
    cancel(reason?: unknown): Promise<void>;
    release(): void;
}

export interface IntelligenceTurnRequest {
    llm: FModelConfiguration;
    messages: AgentChatMessage[];
    modelOverride?: string;
    maxTokens?: number;
}

export interface ProviderErrorShape {
    message?: string;
    type?: string;
    code?: string;
}

export interface ProviderRequestCandidate {
    protocol: FModelProtocolName;
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    adapter: ProtocolAdapter;
}

export interface ProviderConnection {
    candidate: ProviderRequestCandidate;
    response: Response;
}

export interface ProviderAttemptFailure {
    protocol: FModelProtocolName;
    url: string;
    status: number;
    body: string;
    contentType?: string;
}

export type ProtocolAuthMode = 'bearer' | 'optionalBearer' | 'anthropic' | 'google' | 'none';

export interface ProtocolAdapter {
    readonly name: FModelProtocolName;
    readonly defaultPath: string;
    readonly auth: ProtocolAuthMode;
    readonly usesV1Fallback?: boolean;
    readonly defaultVersion?: string;
    readonly acceptsJsonStream?: boolean;
    body(context: ProtocolBuildContext): Record<string, unknown>;
    parseLine(controller: ReadableStreamDefaultController<string>, line: string): boolean;
    missingTerminalMessage(): string;
}

export interface ProtocolBuildContext {
    request: IntelligenceTurnRequest;
    protocol: FModelProtocolConfiguration;
    adapter: ProtocolAdapter;
    resolvedModel: string;
    maxTokens: number;
}

/**
 * Minimal byte-stream reader contract Flyflor needs from `fetch().body.getReader()`.
 * Bun and DOM lib readers differ in extra methods, so the LLM parser depends only on `read()` and `cancel()`.
 */
export interface LlmByteStreamReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
}

export interface StreamingState {
    buffer: string;
    finished: boolean;
}
