import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const SCANNED_DIRS = ["src", "scripts", "tests", "templates", "docs"];
const SECRET_SCANNED_DIRS = ["src", "scripts", "tests", "templates", "docs"];
const DOT_SEGMENTED_FILE = /^[a-z0-9]+(?:\.[a-z0-9]+)*\.[a-z0-9]+$/u;
const OPENAI_SECRET_PATTERN = /\bsk-[a-zA-Z0-9]{16,}\b/u;
// 首页类知识文档约定大写：README/TODO/AGENTS/LOGS/BOUNDARIES/DESIGN（顶层 + docs/ + templates/projects/ 共用）。
const CANONICAL_FRONTPAGE_DOC = /^(README|TODO|AGENTS|LOGS|BOUNDARIES|DESIGN)(?:\.zh\.cn)?\.md$/u;
const LEGACY_MEMORY_PATH_REFERENCES = [
    "src/components/memory/",
    "src/components/crystal/",
    "components/memory/",
    "components/crystal/",
    "cognitive/hippocampus/memory/brain.store.ts",
    "cognitive/hippocampus/memory/working.store.ts",
    "cognitive/hippocampus/memory/markdown.store.ts",
    "project.memory.store.ts",
    "context.fork.store.ts",
    "sqlite.memory.store.ts",
    "sqlite.graph.store.ts",
];
const SINGLE_OWNER_COMPONENT_FILES = [
    "src/socket/adapters.component.ts",
    "src/components/base.component.ts",
    "src/config/config.component.ts",
    "src/agent/context/context.scope.component.ts",
    "src/protocol/contracts/mode.component.ts",
    "src/events/events.component.ts",
];
const DIRECTORY_REPEATED_INFRA_FILES = [
    "src/agent/di/composition/component.metadata.ts",
    "src/agent/di/composition/event.metadata.ts",
    "src/agent/di/composition/injection.metadata.ts",
    "src/agent/di/composition/module.metadata.ts",
    "src/agent/di/factory/component.factory.ts",
    "src/agent/di/factory/dependency.container.ts",
    "src/agent/runtime/planning/block.parser.ts",
    "src/agent/runtime/planning/blocks.ts",
    "src/agent/runtime/streaming/protocol.visibility.ts",
];
const DIRECTORY_OWNER_PREFIX_ALLOWLIST = new Set([
    "src/config/config.ts",
]);
const DIRECTORY_OWNER_PREFIX_ALLOWLIST_PREFIXES = [
    "templates/prompts/",
    "docs/old-docs/",
];
const LEGACY_FCH_TOP_LEVEL_DIRS = ["llm", "crystal", "neural"];
const MIGRATED_FCH_IMPORTS = ["crystal", "hippocampus", "mindstream"];
const MIGRATED_AGENT_IMPORTS = ["context", "skills"];
const ZERO_CHARACTER_SEMANTIC_DIRS = [
    "src/agent/runtime/routing",
    "src/agent/runtime/blackboard",
    "src/agent/runtime/turn",
    "src/agent/runtime/mcp",
    "src/agent/runtime/skills",
    "src/agent/blackboard",
    "src/agent/worker",
    "src/agent/context",
    "src/cognitive/hippocampus/ask",
    "src/cognitive/hippocampus/scope",
    "src/cognitive/hippocampus/memory",
    "src/executive",
];
const ZERO_CHARACTER_ALLOWED_MATCHES = [
    {
        file: "src/agent/runtime/blackboard/route.ts",
        reason: "structured JSON fence extraction from model output",
        snippet: "const fenced = trimmed.match(/^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/u)?.[1]?.trim();",
    },
    {
        file: "src/agent/runtime/mcp/workspace.ts",
        reason: "workspace byte/path search, not business semantic routing",
        snippet: 'if (text.includes("\\u0000")) {',
    },
    {
        file: "src/agent/runtime/mcp/workspace.ts",
        reason: "workspace byte/path search, not business semantic routing",
        snippet: 'if (text.includes("\\u0000")) continue;',
    },
    {
        file: "src/agent/runtime/mcp/workspace.ts",
        reason: "workspace byte/path search, not business semantic routing",
        snippet: "if (!lines[index]!.includes(query)) continue;",
    },
    {
        file: "src/agent/runtime/mcp/workspace.ts",
        reason: "workspace glob/path matching, not business semantic routing",
        snippet: 'const basenameRegex = normalized.includes("/") ? undefined : this.globPatternToRegex(normalized);',
    },
    {
        file: "src/agent/runtime/mcp/workspace.ts",
        reason: "workspace glob/path matching, not business semantic routing",
        snippet: "return (relativePath, basename) => pathRegex.test(relativePath) || basenameRegex?.test(basename) === true;",
    },
    {
        file: "src/agent/runtime/mcp/workspace.ts",
        reason: "workspace glob/path matching, not business semantic routing",
        snippet: 'return new RegExp(`${source}$`, "u");',
    },
    {
        file: "src/agent/runtime/mcp/workspace.ts",
        reason: "workspace glob/path escaping, not business semantic routing",
        snippet: 'return /[\\\\^$+?.()|[\\]{}]/u.test(char) ? `\\\\${char}` : char;',
    },
    {
        file: "src/cognitive/hippocampus/memory/actions/parser.ts",
        reason: "structured enum normalization",
        snippet: "if (action.kind && Object.values(MemoryKind).includes(action.kind)) {",
    },
    {
        file: "src/cognitive/hippocampus/memory/actions/parser.ts",
        reason: "protocol delimiter safety check, not intent detection",
        snippet: "if (action.content.includes(MEMORY_ACTION_BLOCK.open) || action.content.includes(MEMORY_ACTION_BLOCK.close)) {",
    },
    {
        file: "src/cognitive/hippocampus/memory/actions/parser.ts",
        reason: "structured enum normalization",
        snippet: "return typeof value === \"string\" && Object.values(MemoryKind).includes(value as MemoryKind);",
    },
    {
        file: "src/cognitive/hippocampus/memory/consolidation/worker.ts",
        reason: "structured enum normalization",
        snippet: "return known.includes(value) ? (value as ConsolidationDecisionKind) : undefined;",
    },
    {
        file: "src/cognitive/hippocampus/memory/module.ts",
        reason: "concept membership resource metric for scope clustering, not raw text routing",
        snippet: "const clusterEpisodes = episodes.filter((e) => (e.concepts ?? []).includes(topConcept));",
    },
    {
        file: "src/cognitive/hippocampus/memory/markdown/store.ts",
        reason: "markdown duplicate-line formatting check, not business semantic routing",
        snippet: 'const duplicatePattern = new RegExp(`^- ${this.escapeRegExp(normalized)} _\\\\(promoted: .+\\\\)_$`, "m");',
    },
    {
        file: "src/cognitive/hippocampus/memory/markdown/store.ts",
        reason: "markdown duplicate-line formatting check, not business semantic routing",
        snippet: "if (duplicatePattern.test(base)) {",
    },
    {
        file: "src/cognitive/hippocampus/memory/markdown/store.ts",
        reason: "markdown section marker check, not business semantic routing",
        snippet: "if (!base.includes(marker)) {",
    },
    {
        file: "src/cognitive/hippocampus/memory/sqlite/store.ts",
        reason: "SQLite schema column validation",
        snippet: "const hasOnlyCanonicalColumns = names.length === canonical.length && canonical.every((name) => names.includes(name));",
    },
    {
        file: "src/cognitive/hippocampus/memory/recall/matrix.ts",
        reason: "token document-frequency resource metric",
        snippet: "const documentFrequency = documents.filter((document) => document.includes(token)).length;",
    },
    {
        file: "src/cognitive/hippocampus/memory/recall/matrix.ts",
        reason: "CJK tokenization for numeric recall metrics",
        snippet: "const chars = [...text].filter((char) => /\\p{Script=Han}/u.test(char));",
    },
    {
        file: "src/cognitive/hippocampus/memory/feedback/interpreter.ts",
        reason: "structured enum normalization",
        snippet: "return known.includes(value) ? (value as FeedbackCategory) : undefined;",
    },
    {
        file: "src/agent/worker/manager.ts",
        reason: "worker process timeout status mapping from runtime error text",
        snippet: 'const status = message.includes("timed out") ? WorkerTaskStatus.Timeout : WorkerTaskStatus.Failed;',
    },
    {
        file: "src/agent/worker/manager.ts",
        reason: "worker process exit-code allowlist",
        snippet: "if (!okCodes.includes(exitCode)) {",
    },
    {
        file: "src/executive/manifest.ts",
        reason: "descriptor identifier validation",
        snippet: 'if (!/^[a-z][a-z0-9_.-]*$/u.test(value)) {',
    },
    {
        file: "src/executive/manifest.ts",
        reason: "structured enum normalization",
        snippet: 'if (typeof value !== "string" || !Object.values(candidates).includes(value)) {',
    },
    {
        file: "src/executive/registry.ts",
        reason: "descriptor identifier validation",
        snippet: 'if (!/^[a-z][a-z0-9_.-]*$/u.test(descriptor.name)) {',
    },
    {
        file: "src/executive/tool.runtime.ts",
        reason: "structured enum normalization",
        snippet: "return Object.values(ExecutiveLoopGuardReason).includes(value as ExecutiveLoopGuardReason);",
    },
];

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

    test("every canonical markdown source has a zh.cn companion", async () => {
        const rootDocs = ["AGENTS.md", "README.md", "TODO.md", "LOGS.md"].map((file) => join(REPO_ROOT, file));
        const files = [
            ...rootDocs,
            ...(await Promise.all(["docker", "docs", "templates"].map((dir) => listFiles(join(REPO_ROOT, dir))))).flat(),
        ]
            .map((file) => relative(REPO_ROOT, file))
            .filter((file) => file.endsWith(".md") && !file.endsWith(".zh.cn.md"));
        const missing: string[] = [];
        for (const file of files) {
            const companion = file.replace(/\.md$/u, ".zh.cn.md");
            if (!(await exists(join(REPO_ROOT, companion)))) {
                missing.push(file);
            }
        }

        // Markdown is a bilingual contract in this repo. Every source document
        // needs a Chinese review copy beside it so edits cannot drift silently.
        expect(missing).toEqual([]);
    });

    test("zh.cn markdown companions are real Chinese review copies", async () => {
        const rootDocs = ["AGENTS.zh.cn.md", "README.zh.cn.md", "TODO.zh.cn.md", "LOGS.zh.cn.md"].map((file) => join(REPO_ROOT, file));
        const files = [
            ...rootDocs,
            ...(await Promise.all(["docker", "docs", "templates"].map((dir) => listFiles(join(REPO_ROOT, dir))))).flat(),
        ]
            .map((file) => relative(REPO_ROOT, file))
            .filter((file) => file.endsWith(".zh.cn.md"));
        const violations: string[] = [];

        for (const file of files) {
            const text = await Bun.file(join(REPO_ROOT, file)).text();
            if (/机械同步|mechanically synchronized|本轮先保持/u.test(text)) {
                violations.push(`${file}: sync marker`);
                continue;
            }
            const prose = text.replace(/\{\{[^\}]+\}\}/gu, "").replace(/```[\s\S]*?```/gu, "");
            if (file.endsWith("blackboard.worker.envelope.zh.cn.md")) {
                continue;
            }
            const compactProse = prose.replace(/[\s{}\[\]",:._-]/gu, "");
            if (!/[A-Za-z\u3400-\u9fff]/u.test(compactProse)) {
                continue;
            }
            const cjkCount = (prose.match(/[\u3400-\u9fff]/gu) ?? []).length;
            const latinCount = (prose.match(/[A-Za-z]/gu) ?? []).length;
            if (latinCount > 80 && cjkCount < 12) {
                violations.push(`${file}: mostly non-Chinese prose`);
            }
        }

        // zh.cn files are for side-by-side Chinese review, not placeholder
        // copies. JSON-only templates are allowed, but prose-bearing files must
        // contain Chinese text and no mechanical-sync marker.
        expect(violations).toEqual([]);
    });

    test("prompt engineering templates keep English canonical files and Chinese companions", async () => {
        const files = (await listFiles(join(REPO_ROOT, "templates", "prompts")))
            .map((file) => relative(REPO_ROOT, file))
            .filter((file) => file.endsWith(".md"));
        const violations: string[] = [];

        for (const file of files) {
            const prose = stripPromptPlaceholders(await Bun.file(join(REPO_ROOT, file)).text());
            const cjkCount = (prose.match(/[\u3400-\u9fff]/gu) ?? []).length;
            const latinCount = (prose.match(/[A-Za-z]/gu) ?? []).length;
            if (file.endsWith(".zh.cn.md")) {
                if (latinCount > 80 && cjkCount < 12) {
                    violations.push(`${file}: companion is not Chinese`);
                }
                continue;
            }
            if (cjkCount > 0) {
                violations.push(`${file}: canonical prompt template must stay English`);
            }
        }

        // Prompt templates are runtime model contracts. Keep canonical .md
        // files English and maintain .zh.cn.md copies in Chinese for review.
        expect(violations).toEqual([]);
    });

    test("prompt docs templates are docs-only and excluded from runtime manifest", async () => {
        const promptDir = join(REPO_ROOT, "templates", "prompts");
        const manifest = JSON.parse(await Bun.file(join(promptDir, "template.manifest.json")).text()) as {
            templates?: Array<{ filename?: string }>;
        };
        const runtimeFiles = new Set((manifest.templates ?? []).map((entry) => entry.filename));
        const docsFiles = (await listFiles(join(promptDir, "docs")))
            .map((file) => relative(promptDir, file))
            .filter((file) => file.endsWith(".md"));
        const violations = docsFiles.filter((file) => runtimeFiles.has(file) || runtimeFiles.has(basename(file)));

        // templates/prompts/docs renders README text. It is not model-facing
        // runtime prompt material and must stay outside the installed manifest.
        expect(violations).toEqual([]);
    });

    test("prompt manifest stays a file contract without prompt prose", async () => {
        const manifestSource = await Bun.file(join(REPO_ROOT, "src", "agent", "prompts", "template.manifest.ts")).text();
        const forbidden = ["protocolSpec", "expectedOutput", "constraintsJson", "expectedOutputJson"];
        const violations = forbidden.filter((snippet) => manifestSource.includes(snippet));

        // Model-facing protocol prose belongs in templates/prompts/*.md; the
        // manifest only names files and placeholders for runtime loading.
        expect(violations).toEqual([]);
    });

    test("identity memory uses IDENTITY and does not revive removed identity files", async () => {
        const removedIdentityName = ["s", "o", "u", "l"].join("");
        const removedIdentityUpperName = removedIdentityName.toUpperCase();
        const files = [
            `templates/memory/${removedIdentityName}.md`,
            `templates/memory/${removedIdentityName}.zh.cn.md`,
            `docker/workspace/${removedIdentityUpperName}.md`,
            `docker/workspace/${removedIdentityUpperName}.zh.cn.md`,
        ];
        const revived = (
            await Promise.all(files.map(async (file) => ((await exists(join(REPO_ROOT, file))) ? file : undefined)))
        ).filter((file): file is string => Boolean(file));

        // IDENTITY.md is the canonical durable identity file. Keeping removed
        // identity templates around creates a second identity source.
        expect(revived).toEqual([]);
    });

    test("class members declare explicit visibility", async () => {
        const files = (await Promise.all(["src", "scripts", "tests"].map((dir) => listFiles(join(REPO_ROOT, dir)))))
            .flat()
            .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));
        const violations = (await Promise.all(files.map(findImplicitClassMembers))).flat();

        // Explicit visibility is a style boundary: public API stays visible in
        // code review, while private/protected extension points are intentional.
        expect(violations).toEqual([]);
    });

    test("index files stay as barrel exports only", async () => {
        const files = (await listFiles(join(REPO_ROOT, "src"))).filter((file) => basename(file) === "index.ts");
        const violations = (await Promise.all(files.map(findNonBarrelIndexStatements))).flat();

        // Directory entrypoints are public API maps. Keeping implementation
        // out of index.ts prevents hidden helpers from bypassing module shape.
        expect(violations).toEqual([]);
    });

    test("module-owned stores do not leave compatibility shells under components", async () => {
        const files = (await listFiles(join(REPO_ROOT, "src"))).map((file) => relative(REPO_ROOT, file));
        const violations = files.filter(
            (file) => file.startsWith("src/components/memory/") || file.startsWith("src/components/crystal/"),
        );

        // Component base classes live in src/components. Domain stores and
        // domain compatibility exports must stay with their owner modules.
        expect(violations).toEqual([]);
    });

    test("single-owner component modules use directory-first component filenames", async () => {
        const files = (await listFiles(join(REPO_ROOT, "src"))).map((file) => relative(REPO_ROOT, file));
        const violations = SINGLE_OWNER_COMPONENT_FILES.filter((file) => files.includes(file));

        // Directory names carry the domain. A lone component owner should be
        // `component.ts`; repeat the domain only when a directory has several
        // component owners that need disambiguation.
        expect(violations).toEqual([]);
    });

    test("directory-owned infrastructure avoids repeated role filenames", async () => {
        const files = (await listFiles(join(REPO_ROOT, "src"))).map((file) => relative(REPO_ROOT, file));
        const violations = [
            ...files.filter((file) => file.endsWith(".exports.ts")),
            ...DIRECTORY_REPEATED_INFRA_FILES.filter((file) => files.includes(file)),
        ].sort();

        // `index.ts` is the export surface. DI composition/factory and runtime
        // streaming directories already carry the role, so files stay short:
        // metadata.ts -> component.ts/event.ts/etc, container.ts, visibility.ts.
        expect(violations).toEqual([]);
    });

    test("directory-owned files do not repeat their owner prefix", async () => {
        const files = (await listFiles(join(REPO_ROOT, "src"))).map((file) => relative(REPO_ROOT, file));
        const violations = files.filter((file) => hasRepeatedDirectoryOwnerPrefix(file)).sort();

        // Directory is the first convention. Once `src/agent/blackboard/` or
        // `src/cognitive/hippocampus/ask/` names the owner, files use role names such as
        // `module.ts`, `composition.ts`, `parse.ts`, or `manager.ts`.
        expect(violations).toEqual([]);
    });

    test("legacy cognitive code stays collected under the migration directory", async () => {
        const dirs = await listDirs(join(REPO_ROOT, "src"));
        const topLevelNames = new Set(dirs.map((dir) => basename(dir)));
        const violations = LEGACY_FCH_TOP_LEVEL_DIRS.filter((dir) => topLevelNames.has(dir));

        // During R3 migration, cognitive slices move under src/cognitive.
        // These old top-level names must not return as parallel domains.
        expect(violations).toEqual([]);
    });

    test("legacy fch physical directory does not return", async () => {
        // R3 finished with Cognitive owned by src/cognitive. Keeping src/fch
        // around as compatibility shells makes the public boundary ambiguous.
        expect(await exists(join(REPO_ROOT, "src", "fch"))).toBe(false);
    });

    test("Event Fabric stays above protocol instead of under protocol/events", async () => {
        const dirs = await listDirs(join(REPO_ROOT, "src", "protocol"));
        const childNames = new Set(dirs.map((dir) => basename(dir)));

        // Protocol owns serializable contracts/envelopes. The live event bus,
        // sinks and classifiers belong to src/events so gateway and TUI can
        // consume the same fabric without owning it.
        expect(childNames.has("events")).toBe(false);
        expect(await exists(join(REPO_ROOT, "src", "events", "index.ts"))).toBe(true);
    });

    test("new code imports Executive through src/executive instead of the old execution layer", async () => {
        const legacyExecutiveDir = ["c", "t", "t", "l"].join("");
        const files = (await Promise.all(["src", "tests", "scripts"].map((dir) => listFiles(join(REPO_ROOT, dir)))))
            .flat()
            .filter((file) => {
                const rel = relative(REPO_ROOT, file);
                return !rel.startsWith(`src/${legacyExecutiveDir}/`) && (file.endsWith(".ts") || file.endsWith(".tsx"));
            });
        const violations: string[] = [];

        for (const file of files) {
            const rel = relative(REPO_ROOT, file);
            const text = await Bun.file(file).text();
            const legacyImportPattern = new RegExp(`from\\\\s+["'][^"']*/${legacyExecutiveDir}(?:/index)?\\\\.ts["']`, "u");
            if (legacyImportPattern.test(text)) {
                violations.push(rel);
            }
        }

        // Executive is owned by src/executive. The old import surface is gone,
        // so source and tests must exercise the current boundary.
        expect(violations).toEqual([]);
    });

    test("old execution layer physical directory does not return", async () => {
        const legacyExecutiveDir = ["c", "t", "t", "l"].join("");

        // Executive is owned by src/executive. Keeping the old execution layer
        // around as compatibility shells makes the public boundary ambiguous.
        expect(await exists(join(REPO_ROOT, "src", legacyExecutiveDir))).toBe(false);
    });

    test("new code imports migrated cognitive slices through src/cognitive instead of legacy fch", async () => {
        const files = (await Promise.all(["src", "tests", "scripts"].map((dir) => listFiles(join(REPO_ROOT, dir)))))
            .flat()
            .filter((file) => {
                const rel = relative(REPO_ROOT, file);
                return !rel.startsWith("src/fch/") && (file.endsWith(".ts") || file.endsWith(".tsx"));
            });
        const violations: string[] = [];

        for (const file of files) {
            const rel = relative(REPO_ROOT, file);
            const text = await Bun.file(file).text();
            for (const slice of MIGRATED_FCH_IMPORTS) {
                if (new RegExp(`from\\s+["'][^"']*/fch/${slice}(?:/index)?\\.ts["']`, "u").test(text)) {
                    violations.push(`${rel}: ${slice}`);
                }
            }
        }

        // Migrated cognitive slices keep fch compatibility barrels only for
        // external callers. Source and tests should exercise the target path.
        expect(violations).toEqual([]);
    });

    test("new code imports migrated agent slices through src/agent instead of legacy top-level paths", async () => {
        const files = (await Promise.all(["src", "tests", "scripts"].map((dir) => listFiles(join(REPO_ROOT, dir)))))
            .flat()
            .filter((file) => {
                const rel = relative(REPO_ROOT, file);
                return (
                    !rel.startsWith("src/context/") &&
                    !rel.startsWith("src/skills/") &&
                    (file.endsWith(".ts") || file.endsWith(".tsx"))
                );
            });
        const violations: string[] = [];

        for (const file of files) {
            const rel = relative(REPO_ROOT, file);
            const text = await Bun.file(file).text();
            for (const specifier of importSpecifiers(text)) {
                const resolved = normalize(resolve(dirname(file), specifier));
                const target = relative(REPO_ROOT, resolved);
                for (const slice of MIGRATED_AGENT_IMPORTS) {
                    if (target === `src/${slice}/index.ts` || target.startsWith(`src/${slice}/`)) {
                        violations.push(`${rel}: ${slice}`);
                    }
                }
            }
        }

        // R4 moves runtime context and skill loading under src/agent. The old
        // top-level import surfaces are gone, so callers use the owner boundary.
        expect(violations).toEqual([]);
    });

    test("legacy agent slice physical directories do not return", async () => {
        // Context and skills are runtime agent capabilities. Keeping top-level
        // compatibility shells makes the Agent boundary ambiguous.
        expect(await exists(join(REPO_ROOT, "src", "context"))).toBe(false);
        expect(await exists(join(REPO_ROOT, "src", "skills"))).toBe(false);
        expect(await exists(join(REPO_ROOT, "src", "agent", "gateway"))).toBe(false);
    });

    test("hippocampus memory capability subdirectories expose an index entrypoint", async () => {
        const dirs = await listDirs(join(REPO_ROOT, "src", "cognitive", "hippocampus", "memory"));
        const violations: string[] = [];

        for (const dir of dirs) {
            const rel = relative(REPO_ROOT, dir);
            if (!(await exists(join(dir, "index.ts")))) {
                violations.push(rel);
            }
        }

        // Memory is intentionally split by lifecycle/capability. Every child
        // directory has an index.ts so callers can depend on the owner boundary
        // instead of drilling into store/worker/parser implementation files.
        expect(violations.sort()).toEqual([]);
    });

    test("runtime capability subdirectories expose an index entrypoint", async () => {
        const dirs = await listDirs(join(REPO_ROOT, "src", "agent", "runtime"));
        const violations: string[] = [];

        for (const dir of dirs) {
            const rel = relative(REPO_ROOT, dir);
            if (!(await exists(join(dir, "index.ts")))) {
                violations.push(rel);
            }
        }

        // Runtime phases are directory-scoped capabilities. Public imports use
        // the directory entrypoint; implementation files remain owner-internal.
        expect(violations.sort()).toEqual([]);
    });

    test("active docs and source do not point at legacy memory component paths", async () => {
        const files = (await Promise.all(SCANNED_DIRS.map((dir) => listFiles(join(REPO_ROOT, dir)))))
            .flat()
            .filter((file) => !relative(REPO_ROOT, file).startsWith("docs/old-docs/"));
        const violations: string[] = [];

        for (const file of files) {
            const rel = relative(REPO_ROOT, file);
            if (rel === "tests/naming.boundaries.test.ts") continue;
            const text = await Bun.file(file).text();
            for (const needle of LEGACY_MEMORY_PATH_REFERENCES) {
                if (text.includes(needle)) {
                    violations.push(`${rel}: ${needle}`);
                }
            }
        }

        // The memory migration is directory-contract driven. References to old
        // component-domain paths are as harmful as the files themselves.
        expect(violations).toEqual([]);
    });

    test("release surface does not contain OpenAI-looking secret keys", async () => {
        const files = (await Promise.all(SECRET_SCANNED_DIRS.map((dir) => listFiles(join(REPO_ROOT, dir))))).flat();
        const violations: string[] = [];

        for (const file of files) {
            const text = await Bun.file(file).text();
            if (!OPENAI_SECRET_PATTERN.test(text)) continue;
            violations.push(relative(REPO_ROOT, file));
        }

        // Test credentials should use obvious non-provider placeholders so
        // release scans can treat any sk-* match as suspicious.
        expect(violations).toEqual([]);
    });
});

function isAllowedFilename(file: string): boolean {
    const name = basename(file);
    if (CANONICAL_FRONTPAGE_DOC.test(name)) {
        return true;
    }
    return DOT_SEGMENTED_FILE.test(name);
}

function stripPromptPlaceholders(text: string): string {
    return text.replace(/\{\{[^\}]+\}\}/gu, "").replace(/```[\s\S]*?```/gu, "");
}

function hasRepeatedDirectoryOwnerPrefix(file: string): boolean {
    if (DIRECTORY_OWNER_PREFIX_ALLOWLIST.has(file)) {
        return false;
    }
    if (DIRECTORY_OWNER_PREFIX_ALLOWLIST_PREFIXES.some((prefix) => file.startsWith(prefix))) {
        return false;
    }

    const parts = file.split("/");
    const filename = parts.at(-1);
    const owner = parts.at(-2);
    if (!filename || !owner || !filename.endsWith(".ts")) {
        return false;
    }
    const base = filename.slice(0, -".ts".length);
    return base === owner || base.startsWith(`${owner}.`);
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

async function listDirs(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
}

async function exists(path: string): Promise<boolean> {
    try {
        await Bun.file(path).stat();
        return true;
    } catch {
        return false;
    }
}

function importSpecifiers(text: string): string[] {
    const specifiers: string[] = [];
    const pattern = /from\s+["']([^"']+)["']/gu;
    for (const match of text.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier?.startsWith(".")) {
            specifiers.push(specifier);
        }
    }
    return specifiers;
}

async function findImplicitClassMembers(file: string): Promise<string[]> {
    const text = await Bun.file(file).text();
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
            for (const member of node.members) {
                if (isVisibilityCheckedMember(member) && !hasVisibilityModifier(member)) {
                    const line = source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1;
                    violations.push(`${relative(REPO_ROOT, file)}:${line}`);
                }
                if (ts.isConstructorDeclaration(member)) {
                    for (const parameter of member.parameters) {
                        if (!isImplicitPublicParameterProperty(parameter)) continue;
                        const parameterLine = source.getLineAndCharacterOfPosition(parameter.getStart(source)).line + 1;
                        violations.push(`${relative(REPO_ROOT, file)}:${parameterLine}`);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return violations;
}

function isVisibilityCheckedMember(member: ts.ClassElement): boolean {
    return (
        ts.isConstructorDeclaration(member) ||
        ts.isMethodDeclaration(member) ||
        ts.isPropertyDeclaration(member) ||
        ts.isGetAccessor(member) ||
        ts.isSetAccessor(member)
    );
}

function hasVisibilityModifier(member: ts.ClassElement): boolean {
    const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
    return (
        modifiers?.some(
            (modifier: ts.Modifier) =>
                modifier.kind === ts.SyntaxKind.PublicKeyword ||
                modifier.kind === ts.SyntaxKind.PrivateKeyword ||
                modifier.kind === ts.SyntaxKind.ProtectedKeyword,
        ) === true
    );
}

function isImplicitPublicParameterProperty(parameter: ts.ParameterDeclaration): boolean {
    const modifiers = ts.canHaveModifiers(parameter) ? ts.getModifiers(parameter) : undefined;
    const hasParameterProperty = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) === true;
    if (!hasParameterProperty) return false;
    return (
        modifiers?.some(
            (modifier: ts.ModifierLike) =>
                modifier.kind === ts.SyntaxKind.PublicKeyword ||
                modifier.kind === ts.SyntaxKind.PrivateKeyword ||
                modifier.kind === ts.SyntaxKind.ProtectedKeyword,
        ) !== true
    );
}

async function findNonBarrelIndexStatements(file: string): Promise<string[]> {
    const text = await Bun.file(file).text();
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations: string[] = [];
    for (const statement of source.statements) {
        if (isAllowedIndexStatement(statement)) continue;
        const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
        violations.push(`${relative(REPO_ROOT, file)}:${line}`);
    }
    return violations;
}

function isAllowedIndexStatement(statement: ts.Statement): boolean {
    if (ts.isExportDeclaration(statement)) return true;
    if (ts.isImportDeclaration(statement)) return Boolean(statement.importClause?.isTypeOnly);
    return ts.isEmptyStatement(statement);
}
