import { describe, expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

describe("documentation references", () => {
    test("referenced test files exist", async () => {
        const docs = ["README.md", ...(await listMarkdownFiles(join(REPO_ROOT, "docs")))];
        const refs: string[] = [];
        for (const doc of docs) {
            const text = await Bun.file(join(REPO_ROOT, doc)).text();
            for (const match of text.matchAll(/tests\/[A-Za-z0-9./-]+\.test\.ts/gu)) {
                refs.push(match[0]);
            }
        }

        const missing: string[] = [];
        for (const ref of Array.from(new Set(refs)).sort()) {
            if (!(await exists(join(REPO_ROOT, ref)))) {
                missing.push(ref);
            }
        }

        expect(missing).toEqual([]);
    });

    test("crystal docs keep runtime Gem gate distinct from graph evidence count", async () => {
        const docs = ["README.md", "docs/crystal.reflection.md", "docs/memory.system.md"];
        const staleClaims: string[] = [];

        for (const doc of docs) {
            const text = await Bun.file(join(REPO_ROOT, doc)).text();
            if (/memory_node\s+confidence\s*>\s*0\.5\s+AND\s+evidenceCount\s*(?:>=|≥)\s*3/iu.test(text)) {
                staleClaims.push(doc);
            }
        }

        expect(staleClaims).toEqual([]);
    });

    test("control protocol docs keep snapshot layers distinct and a single error section", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "control.protocol.md")).text();
        const errorHeadings = doc.match(/^## Error$/gmu) ?? [];

        expect(doc).toContain("## Snapshot Matrix");
        expect(doc).toContain("连接级 snapshot");
        expect(doc).toContain("turn 级 snapshot");
        expect(doc).toContain("事件流");
        expect(errorHeadings).toHaveLength(1);
    });

    test("ws api docs cite the live gateway tests and core message types", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "ws.doc.md")).text();

        expect(doc).toContain("tests/gateway.control.smoke.test.ts");
        expect(doc).toContain("tests/gateway.ws.test.ts");
        expect(doc).toContain("tests/protocol.control.test.ts");
        expect(doc).toContain("tests/gateway.module.test.ts");
        expect(doc).toContain("tests/tui.chat.history.test.ts");
        expect(doc).toContain("server.hello");
        expect(doc).toContain("gateway.status.snapshot");
        expect(doc).toContain("capability.catalog.snapshot");
        expect(doc).toContain("turn.final");
        expect(doc).toContain("invalid-envelope");
        expect(doc).toContain("gateway.message.send payload requires text");
        expect(doc).toContain("历史对话列表获取");
        expect(doc).toContain("history.list");
        expect(doc).toContain("history.snapshot");
        expect(doc).toContain("listChatHistory");
        expect(doc).toContain("executive.loop.paused");
        expect(doc).toContain("executive.loop.resumed");
    });

    test("runtime events docs keep event timeline separate from turn-final authority", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "runtime.events.md")).text();

        expect(doc).toContain("## Event Matrix");
        expect(doc).toContain("当前轮权威状态仍读 `turn.final.reply.metadata`");
        expect(doc).toContain("结构化快照仍读 `turn.final.reply.metadata.planning`");
        expect(doc).toContain("`RuntimeEvent` 默认是时间线事实流");
    });

    test("rust integration guide keeps the ws handoff checklist stable", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "rust.integration.md")).text();

        expect(doc).toContain("## 最小连接流程");
        expect(doc).toContain("## Snapshot 分层");
        expect(doc).toContain("gateway.message.send");
        expect(doc).toContain("turn.final.reply.metadata.ask");
        expect(doc).toContain("turn.final.reply.metadata.planning");
        expect(doc).toContain("turn.final.reply.metadata.executiveToolLoop");
        expect(doc).toContain("event.publish");
    });

    test("rust connection core guide keeps handshake and reconnect contracts stable", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "rust.connection.core.md")).text();

        expect(doc).toContain("/ws");
        expect(doc).toContain("server.hello");
        expect(doc).toContain("client.hello");
        expect(doc).toContain("gateway.status.get");
        expect(doc).toContain("capability.catalog.get");
        expect(doc).toContain("ping");
        expect(doc).toContain("pong");
        expect(doc).toContain("reconnecting");
        expect(doc).toContain("Snapshot Cache Ownership");
        expect(doc).toContain("连接级状态与 Turn 级状态分层");
    });

    test("rust gateway shell backlog keeps the implementation slices stable", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "rust.gateway.shell.backlog.md")).text();

        expect(doc).toContain("## Slice 1: Connection Core");
        expect(doc).toContain("rust.connection.core.md");
        expect(doc).toContain("## Slice 2: Stream Renderer");
        expect(doc).toContain("## Slice 3: Ask Loop");
        expect(doc).toContain("## Slice 4: Planning Panel");
        expect(doc).toContain("## Slice 5: Long-Horizon Loop Recovery");
        expect(doc).toContain("## Slice 6: Event Timeline");
        expect(doc).toContain("## Slice 7: Shell UX");
    });

    test("directory architecture docs cover the live source ownership layers", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "directory.architecture.md")).text();

        expect(doc).toContain("`src/agent/prompts`");
        expect(doc).toContain("`src/entities`");
        expect(doc).toContain("`src/components`");
        expect(doc).toContain("`src/types`");
        expect(doc).toContain("`src/protocol/control`");
        expect(doc).toContain("`src/agent/gateway`");
    });
});

async function listMarkdownFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const path = join(root, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "scripts" || entry.name === "old-docs") {
                    return [];
                }
                return listMarkdownFiles(path);
            }
            if (entry.isFile() && entry.name.endsWith(".md")) {
                return [path.slice(REPO_ROOT.length + 1)];
            }
            return [];
        }),
    );
    return nested.flat();
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}
