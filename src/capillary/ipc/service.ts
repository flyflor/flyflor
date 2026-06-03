import { FService, Inject, Service } from "@/core";

/**
 * One IPC message exchanged with a client (CLI, Web, or future Rust TUI).
 * `kind` is the protocol direction/status; `content` is the user input, agent output, or error text.
 */
export interface IPCMessage {
    kind: "user" | "agent" | "error";
    content: string;
}

/**
 * The IPC conversation service: the shared boundary behind every transport.
 *
 * It intentionally does not own LLM logic. External transports hand a user message in; this service forwards
 * it to the cluster-backed agent worker facade and returns the agent reply.
 */
@Service()
export class IPCService extends FService {}
