import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

describe("documentation index", () => {
    test("docs/README links every top-level canonical docs page", async () => {
        const docsDir = join(REPO_ROOT, "docs");
        const docsReadme = await readFile(join(docsDir, "README.md"), "utf8");
        const files = await readdir(docsDir, { withFileTypes: true });
        const expectedLinks = files
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => name.endsWith(".md"))
            .filter((name) => name !== "README.md")
            .filter((name) => !name.endsWith(".zh.cn.md"))
            .sort();

        const missing = expectedLinks.filter((name) => !docsReadme.includes(`](${name})`));
        expect(missing).toEqual([]);
    });

    test("root README links every core docs index entry", async () => {
        const rootReadme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
        const docsReadme = await readFile(join(REPO_ROOT, "docs", "README.md"), "utf8");
        const coreDocLinks = Array.from(docsReadme.matchAll(/\]\(([^)]+\.md)\)/gu))
            .map((match) => match[1])
            .filter((href): href is string => Boolean(href))
            .filter((href) => !href.startsWith("../"))
            .filter((href) => !href.startsWith("reference/"))
            .sort();
        const missing = coreDocLinks.filter((href) => !rootReadme.includes(`](docs/${href})`));

        expect(missing).toEqual([]);
    });
});
