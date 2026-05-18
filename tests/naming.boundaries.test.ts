import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const SCANNED_DIRS = ["src", "scripts", "tests", "templates", "docs"];
const SECRET_SCANNED_DIRS = ["src", "scripts", "tests", "templates", "docs"];
const DOT_SEGMENTED_FILE = /^[a-z0-9]+(?:\.[a-z0-9]+)*\.[a-z0-9]+$/u;
const OPENAI_SECRET_PATTERN = /\bsk-[a-zA-Z0-9]{16,}\b/u;
const CANONICAL_MEMORY_TEMPLATE = /^(MEMORY|SELF|SOUL|USER)(?:\.zh\.cn)?\.md$/u;
// 首页类知识文档约定大写：README/TODO/AGENTS/BOUNDARIES/DESIGN（顶层 + docs/ + templates/projects/ 共用）。
const CANONICAL_FRONTPAGE_DOC = /^(README|TODO|AGENTS|BOUNDARIES|DESIGN)\.md$/u;
const LEGACY_MEMORY_PATH_REFERENCES = [
    "src/components/memory/",
    "src/components/crystal/",
    "components/memory/",
    "components/crystal/",
    "fch/hippocampus/memory/brain.store.ts",
    "fch/hippocampus/memory/working.store.ts",
    "fch/hippocampus/memory/markdown.store.ts",
    "project.memory.store.ts",
    "context.fork.store.ts",
    "sqlite.memory.store.ts",
    "sqlite.graph.store.ts",
];
const SINGLE_OWNER_COMPONENT_FILES = [
    "src/agent/gateway/adapters.component.ts",
    "src/components/base.component.ts",
    "src/config/config.component.ts",
    "src/context/context.scope.component.ts",
    "src/fch/crystal/gems/gem.component.ts",
    "src/fch/crystal/memory/crystal.memory.component.ts",
    "src/fch/mindstream/model.component.ts",
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
    "src/command/command.ts",
    "src/command/cli/cli.ts",
    "src/command/tui/chat/chat.entry.ts",
]);
const DIRECTORY_OWNER_PREFIX_ALLOWLIST_PREFIXES = [
    "templates/prompts/",
    "docs/old-docs/",
];
const LEGACY_FCH_TOP_LEVEL_DIRS = ["llm", "crystal", "neural"];
const LEGACY_FCH_CHILD_DIRS = ["fluid", "llmriver"];

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
        // `src/fch/hippocampus/ask/` names the owner, files use role names such as
        // `module.ts`, `composition.ts`, `parse.ts`, or `manager.ts`.
        expect(violations).toEqual([]);
    });

    test("legacy cognitive code stays collected under the migration directory", async () => {
        const dirs = await listDirs(join(REPO_ROOT, "src"));
        const topLevelNames = new Set(dirs.map((dir) => basename(dir)));
        const violations = LEGACY_FCH_TOP_LEVEL_DIRS.filter((dir) => topLevelNames.has(dir));

        // During P2 migration, mindstream, crystal and hippocampus still live
        // under the legacy cognitive directory instead of returning as top-level domains.
        expect(violations).toEqual([]);
    });

    test("mindstream does not regress to old transient names", async () => {
        const dirs = await listDirs(join(REPO_ROOT, "src", "fch"));
        const childNames = new Set(dirs.map((dir) => basename(dir)));
        const violations = LEGACY_FCH_CHILD_DIRS.filter((dir) => childNames.has(dir));

        // Mindstream names the current reasoning/generation flow. The old
        // fluid/llmriver names should not return as real source directories.
        expect(violations).toEqual([]);
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

    test("hippocampus memory capability subdirectories expose an index entrypoint", async () => {
        const dirs = await listDirs(join(REPO_ROOT, "src", "fch", "hippocampus", "memory"));
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
    if (file.startsWith("templates/memory/") && CANONICAL_MEMORY_TEMPLATE.test(name)) {
        return true;
    }
    if (CANONICAL_FRONTPAGE_DOC.test(name)) {
        return true;
    }
    return DOT_SEGMENTED_FILE.test(name);
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
