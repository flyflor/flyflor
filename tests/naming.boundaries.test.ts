import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const SCANNED_DIRS = ["src", "scripts", "tests", "templates", "docs"];
const DOT_SEGMENTED_FILE = /^[a-z0-9]+(?:\.[a-z0-9]+)*\.[a-z0-9]+$/u;
const CANONICAL_MEMORY_TEMPLATE = /^(MEMORY|SELF|SOUL|USER)(?:\.zh\.cn)?\.md$/u;
// 首页类知识文档约定大写：README/TODO/AGENTS/BOUNDARIES/DESIGN（顶层 + docs/ + templates/projects/ 共用）。
const CANONICAL_FRONTPAGE_DOC = /^(README|TODO|AGENTS|BOUNDARIES|DESIGN)\.md$/u;

describe("repository naming boundary", () => {
    test("uses dot-suffix filenames for source, scripts, tests, docs, and templates", async () => {
        const files = (await Promise.all(SCANNED_DIRS.map((dir) => listFiles(join(REPO_ROOT, dir))))).flat();
        const violations = files.map((file) => relative(REPO_ROOT, file)).filter((file) => !isAllowedFilename(file));

        expect(violations).toEqual([]);
    });

    test("keeps prompt and memory templates on dot names with no legacy hyphen or underscore files", async () => {
        const files = await listFiles(join(REPO_ROOT, "templates"));
        const legacyNames = files
            .map((file) => relative(REPO_ROOT, file))
            .filter((file) => /[-_]/u.test(basename(file)));

        expect(legacyNames).toEqual([]);
    });
});

function isAllowedFilename(file: string): boolean {
    const name = basename(file);
    if (file.startsWith("templates/memory/") && CANONICAL_MEMORY_TEMPLATE.test(name)) {
        return true;
    }
    if (CANONICAL_FRONTPAGE_DOC.test(name)) {
        return true;
    }
    return DOT_SEGMENTED_FILE.test(name);
}

async function listFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const path = join(root, entry.name);
            if (entry.isDirectory()) {
                return listFiles(path);
            }
            return entry.isFile() ? [path] : [];
        }),
    );
    return nested.flat();
}
