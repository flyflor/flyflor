import { Component, FComponent } from "@/core";

/**
 * Roles stored in the agent's live working context.
 * `User` is inbound human text; `Agent` is the model-backed reply produced by Flyflor.
 */
export enum ContextRole {
    User = "user",
    Agent = "agent",
}

/**
 * One item in the agent's live working context.
 * `role` names who produced the content; `content` is the raw turn text; `createdAt` is ISO wall-clock time.
 */
export interface ContextItem {
    role: ContextRole;
    content: string;
    createdAt: string;
}

/**
 * The agent's live working context (shard slice) — in-flight workspace for current session.
 * Holds ordered items the kernel distills/recalls from (see `core/mind`). Intentionally minimal:
 * append items, read snapshot. Distillation owned by mind layer.
 */
@Component()
export class ContextComponent extends FComponent {
    private readonly items: ContextItem[] = [];

    /**
     * Appends one observed turn to the in-memory context shard.
     * @param role - the producer of the content.
     * @param content - the raw text produced by that role.
     */
    public append(role: ContextRole, content: string): void {
        this.items.push({ role, content, createdAt: new Date().toISOString() });
    }

    /**
     * Returns a snapshot of the current context shard.
     * @returns ordered context items copied out of the component's local state.
     */
    public snapshot(): readonly ContextItem[] {
        return [...this.items];
    }
}
