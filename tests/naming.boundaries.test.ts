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
    "neural/memory/brain.store.ts",
    "neural/memory/working.store.ts",
    "neural/memory/markdown.store.ts",
    "project.memory.store.ts",
    "context.fork.store.ts",
    "sqlite.memory.store.ts",
    "sqlite.graph.store.ts",
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
