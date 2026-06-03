import { join } from "node:path";

/** Source glob checked for Flyflor red-line constraints. */
const SOURCE_GLOB = "src/**/*.ts";

/** Application entry file checked alongside `src`. */
const ENTRY_FILE = "app.ts";

/** Directory that owns canonical English prompts and Chinese mirrors. */
const PROMPTS_DIR = "prompts";

/** Canonical config file path. */
const CONFIG_FILE = ".config/config.jsonc";

/** Built-in constructors allowed outside the IoC container. */
const ALLOWED_RUNTIME_CONSTRUCTORS = new Set(["Date", "Error", "Map", "Response", "Set", "TextDecoder"]);

/**
 * One red-line check failure.
 * `file` is repo-relative; `message` explains the violated rule.
 */
interface CheckFailure {
    file: string;
    message: string;
}

/** Collected failures emitted together so developers get one actionable report. */
const failures: CheckFailure[] = [];

await checkConfig();
await checkPromptMirrors();
await checkCustomNewSites();

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(`[check] ${failure.file}: ${failure.message}`);
    }
    process.exit(1);
}

console.log("[check] ok");

/**
 * Verifies that the single JSONC config file exists.
 */
async function checkConfig(): Promise<void> {
    if (!(await Bun.file(CONFIG_FILE).exists())) {
        failures.push({ file: CONFIG_FILE, message: "missing single runtime config file" });
    }
}

/**
 * Verifies every canonical prompt has a `.zh.cn.md` mirror and every mirror has an English source.
 */
async function checkPromptMirrors(): Promise<void> {
    const prompts = await listFiles(`${PROMPTS_DIR}/*.md`);
    const promptSet = new Set(prompts);
    for (const prompt of prompts) {
        if (prompt.endsWith(".zh.cn.md")) {
            const english = prompt.replace(".zh.cn.md", ".md");
            if (!promptSet.has(english)) {
                failures.push({ file: prompt, message: "missing canonical English prompt" });
            }
            continue;
        }
        const mirror = prompt.replace(".md", ".zh.cn.md");
        if (!promptSet.has(mirror)) {
            failures.push({ file: prompt, message: "missing Chinese prompt mirror" });
        }
    }
}

/**
 * Verifies container-managed custom classes are not constructed outside `src/core/ioc/container.ts`.
 */
async function checkCustomNewSites(): Promise<void> {
    const files = [ENTRY_FILE, ...(await listFiles(SOURCE_GLOB))];
    const newExpression = /\bnew\s+([A-Z][A-Za-z0-9_]*)\b/g;
    for (const file of files) {
        if (file === "src/core/ioc/container.ts") {
            continue;
        }
        const source = await Bun.file(file).text();
        for (const match of source.matchAll(newExpression)) {
            const ctor = match[1];
            if (ctor === undefined || ALLOWED_RUNTIME_CONSTRUCTORS.has(ctor)) {
                continue;
            }
            failures.push({ file, message: `custom constructor '${ctor}' must be resolved via IoC` });
        }
    }
}

/**
 * Lists files from a Bun glob using repo-relative paths.
 * @param pattern - Bun glob pattern rooted at the current working directory.
 * @returns matched repo-relative paths.
 */
async function listFiles(pattern: string): Promise<string[]> {
    const glob = new Bun.Glob(pattern);
    const files: string[] = [];
    for await (const file of glob.scan({ cwd: process.cwd(), absolute: false, onlyFiles: true })) {
        files.push(join(file));
    }
    return files;
}
