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

    test("gateway docs use the shipped GatewayMessage id field", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "gateway.channels.md")).text();
        expect(doc).toContain("interface GatewayMessage");
        expect(doc).toContain("id: string;");
        expect(doc).not.toContain("interface GatewayMessage {\n    messageId: string;");
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
