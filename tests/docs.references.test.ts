import { describe, expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

describe("documentation references", () => {
    test("referenced test files exist", async () => {
        const docs = ["README.md", "TODO.md", ...(await listMarkdownFiles(join(REPO_ROOT, "docs")))];
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
});

async function listMarkdownFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const path = join(root, entry.name);
            if (entry.isDirectory()) {
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
