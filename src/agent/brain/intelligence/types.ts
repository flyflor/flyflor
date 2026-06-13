import type { AgentMemory } from '@/agent/memory';
import { type FModelConfiguration, type FModelProtocolConfiguration, FModelProtocolName } from '@/config';

export interface ProviderErrorShape {
    message?: string;
    type?: string;
    code?: string;
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
    config: FModelConfiguration;
    messages: AgentMemory[];
    protocol: FModelProtocolConfiguration;
    adapter: ProtocolAdapter;
    model: string;
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
