/**
 * RetrospectiveLog: project-scoped append-only Markdown log of long-term
 * memory consolidation outcomes (consolidate / discard) plus skill / cluster
 * promotion events. Written to `<projectMemoryDir>/RETROSPECTIVE.md` so users
 * can audit what their agent has been promoting or forgetting.
 *
 * Format (one entry = one block separated by a blank line):
 *
 * ## 2024-06-10T14:22:01.337Z — consolidate
 * - userId: u_42
 * - episodeId: ep_…
 * - summary: <short summary>
 * - symbols: [a, b, c]
 * - rationale: …
 *
 * Failures (mkdir / disk full) are swallowed — auditing must not break the
 * consolidation hot path.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const FILE_NAME = "RETROSPECTIVE.md";
const HEADER = "# RETROSPECTIVE\n\n> Append-only audit log of long-term memory consolidations.\n\n";

export interface RetrospectiveEntry {
    at?: string;
    kind: "consolidate" | "discard" | "reinforce" | "skill-promoted" | "cluster-promoted" | "custom";
    userId?: string;
    episodeId?: string;
    summary?: string;
    symbols?: readonly string[];
    rationale?: string;
    extra?: Record<string, string | number | boolean>;
}

export interface RetrospectiveLogOptions {
    projectMemoryDir: string;
}

export class RetrospectiveLog {
    private readonly projectMemoryDir: string;

    constructor(options: RetrospectiveLogOptions) {
        this.projectMemoryDir = options.projectMemoryDir;
    }

    path(): string {
        return join(this.projectMemoryDir, FILE_NAME);
    }

    async append(entry: RetrospectiveEntry): Promise<void> {
        try {
            await mkdir(this.projectMemoryDir, { recursive: true });
            const file = Bun.file(this.path());
            if (!(await file.exists())) {
                await Bun.write(this.path(), HEADER);
            }
            const block = renderEntry(entry);
            const existing = await Bun.file(this.path()).text();
            await Bun.write(this.path(), `${existing}${block}\n`);
        } catch {
            // intentional: never fail the caller for an audit write
        }
    }

    async read(options: { tail?: number } = {}): Promise<string> {
        const file = Bun.file(this.path());
        if (!(await file.exists())) return "";
        const text = await file.text();
        const tail = options.tail;
        if (!tail || !Number.isFinite(tail) || tail <= 0) return text;
        const blocks = text.split(/\n## /).filter((segment) => segment.trim().length > 0);
        const headerIndex = blocks.findIndex((b) => b.startsWith("RETROSPECTIVE"));
        const header = headerIndex >= 0 ? `## ${blocks[headerIndex]}` : "";
        const entries = headerIndex >= 0 ? blocks.slice(headerIndex + 1) : blocks;
        const slice = entries.slice(-tail).map((entry) => `## ${entry}`);
        return [header, ...slice].filter(Boolean).join("\n");
    }
}

function renderEntry(entry: RetrospectiveEntry): string {
    const at = entry.at ?? new Date().toISOString();
    const lines = [`## ${at} — ${entry.kind}`];
    if (entry.userId) lines.push(`- userId: ${entry.userId}`);
    if (entry.episodeId) lines.push(`- episodeId: ${entry.episodeId}`);
    if (entry.summary) lines.push(`- summary: ${stripNewlines(entry.summary)}`);
    if (entry.symbols && entry.symbols.length > 0) lines.push(`- symbols: [${entry.symbols.join(", ")}]`);
    if (entry.rationale) lines.push(`- rationale: ${stripNewlines(entry.rationale)}`);
    if (entry.extra) {
        for (const [key, value] of Object.entries(entry.extra)) {
            lines.push(`- ${key}: ${value}`);
        }
    }
    return `${lines.join("\n")}\n`;
}

function stripNewlines(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}
