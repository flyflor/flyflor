import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const OFFICIAL_HOMEPAGE = "https://flyflor.qingshen.xin";

describe("documentation index", () => {
    test("docs/README links every top-level canonical docs page", async () => {
        const docsDir = join(REPO_ROOT, "docs");
        const docsReadme = await readFile(join(docsDir, "README.md"), "utf8");
        const docsReadmeZhCn = await readFile(join(docsDir, "README.zh.cn.md"), "utf8");
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

        const unexpectedChineseIndexLinks = expectedLinks.filter((name) => docsReadmeZhCn.includes(`](${name})`));
        expect(unexpectedChineseIndexLinks).toEqual([]);
    });

    test("docs/README.zh.cn links every top-level Chinese docs page", async () => {
        const docsDir = join(REPO_ROOT, "docs");
        const docsReadmeZhCn = await readFile(join(docsDir, "README.zh.cn.md"), "utf8");
        const files = await readdir(docsDir, { withFileTypes: true });
        const expectedLinks = files
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => name.endsWith(".zh.cn.md"))
            .filter((name) => name !== "README.zh.cn.md")
            .sort();

        const missing = expectedLinks.filter((name) => !docsReadmeZhCn.includes(`](${name})`));
        expect(missing).toEqual([]);
    });

    test("root README links every canonical core docs index entry", async () => {
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

    test("root README.zh.cn links every Chinese core docs index entry", async () => {
        const rootReadmeZhCn = await readFile(join(REPO_ROOT, "README.zh.cn.md"), "utf8");
        const docsReadmeZhCn = await readFile(join(REPO_ROOT, "docs", "README.zh.cn.md"), "utf8");
        const coreDocLinks = Array.from(docsReadmeZhCn.matchAll(/\]\(([^)]+\.zh\.cn\.md)\)/gu))
            .map((match) => match[1])
            .filter((href): href is string => Boolean(href))
            .filter((href) => !href.startsWith("../"))
            .filter((href) => !href.startsWith("reference/"))
            .sort();
        const missing = coreDocLinks.filter((href) => !rootReadmeZhCn.includes(`](docs/${href})`));

        expect(missing).toEqual([]);
    });

    test("rust integration guide is indexed only as an external reference", async () => {
        const rootReadme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
        const rootReadmeZhCn = await readFile(join(REPO_ROOT, "README.zh.cn.md"), "utf8");
        const docsReadme = await readFile(join(REPO_ROOT, "docs", "README.md"), "utf8");

        expect(docsReadme).toContain("## 外部仓库参考");
        expect(docsReadme).toContain("](old-docs/rust.integration.md)");
        expect(rootReadme).toContain("](docs/old-docs/rust.integration.md)");
        expect(rootReadmeZhCn).toContain("](docs/old-docs/rust.integration.zh.cn.md)");
        expect(docsReadme).not.toContain("Rust 外壳最小接入");
        expect(rootReadme).not.toContain("Rust socket/channel/cli/tui 外壳最小接入手册");
    });

    test("rust gateway shell backlog is indexed only as an external reference", async () => {
        const rootReadme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
        const rootReadmeZhCn = await readFile(join(REPO_ROOT, "README.zh.cn.md"), "utf8");
        const docsReadme = await readFile(join(REPO_ROOT, "docs", "README.md"), "utf8");

        expect(docsReadme).toContain("](old-docs/rust.gateway.shell.backlog.md)");
        expect(rootReadme).toContain("](docs/old-docs/rust.gateway.shell.backlog.md)");
        expect(rootReadmeZhCn).toContain("](docs/old-docs/rust.gateway.shell.backlog.zh.cn.md)");
        expect(docsReadme).not.toContain("Rust shell 分 slice backlog");
        expect(rootReadme).not.toContain("Rust socket shell 工程切分 backlog");
    });

    test("rust connection core guide is indexed only as an external reference", async () => {
        const rootReadme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
        const rootReadmeZhCn = await readFile(join(REPO_ROOT, "README.zh.cn.md"), "utf8");
        const docsReadme = await readFile(join(REPO_ROOT, "docs", "README.md"), "utf8");

        expect(docsReadme).toContain("](old-docs/rust.connection.core.md)");
        expect(rootReadme).toContain("](docs/old-docs/rust.connection.core.md)");
        expect(rootReadmeZhCn).toContain("](docs/old-docs/rust.connection.core.zh.cn.md)");
        expect(docsReadme).not.toContain("Rust `/ws` 连接核心");
        expect(rootReadme).not.toContain("Rust Slice 1 `/ws` 连接核心与重连状态机");
    });

    test("public docs and package metadata point at the official homepage", async () => {
        const rootReadme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
        const docsReadme = await readFile(join(REPO_ROOT, "docs", "README.md"), "utf8");
        const packageJson = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")) as { homepage?: string };

        expect(rootReadme).toContain(OFFICIAL_HOMEPAGE);
        expect(docsReadme).toContain(OFFICIAL_HOMEPAGE);
        expect(packageJson.homepage).toBe(OFFICIAL_HOMEPAGE);
    });
});
