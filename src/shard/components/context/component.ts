import { Component, FComponent } from "@/core";

export interface ContextItem {
    role: string;
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

    public append(role: string, content: string): void {
        this.items.push({ role, content, createdAt: new Date().toISOString() });
    }

    public snapshot(): readonly ContextItem[] {
        return [...this.items];
    }
}
