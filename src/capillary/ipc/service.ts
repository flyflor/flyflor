import { FService, Inject, Runtime, Service } from '@/core';

/** Minimum user message length accepted by IPC before forwarding into runtime. */
const MIN_USER_MESSAGE_LENGTH = 1;

/**
 * One IPC message exchanged with a client (CLI, Web, or future Rust TUI).
 * `kind` is the protocol direction/status; `content` is the user input, agent output, or error text.
 */
export interface IPCMessage {
    kind: 'user' | 'agent' | 'error';
    content: string;
}

/**
 * The IPC conversation service: the shared boundary behind every transport.
 *
 * It intentionally does not own LLM logic. External transports hand a user message in; this service forwards
 * it to the cluster-backed agent worker facade and returns the agent reply.
 */
@Service()
export class IPCService extends FService {
    @Inject()
    public readonly runtime!: Runtime;

    /**
     * Forwards one user message from any IPC transport into the runtime agent.
     * @param content - Raw user text received from the external client.
     * @returns The model-backed reply returned by the runtime.
     */
    public async handleUserMessage(content: string): Promise<string> {
        const text = content.trim();
        if (text.length < MIN_USER_MESSAGE_LENGTH) {
            throw Object.assign(Error('IPC user message is empty'), { detail: { contentLength: content.length } });
        }
        return this.runtime.chat(text);
    }
}
