import { describe, expect, test } from "bun:test";
import ts from "typescript";
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

    test("class members declare explicit visibility", async () => {
        const files = (await Promise.all(["src", "scripts", "tests"].map((dir) => listFiles(join(REPO_ROOT, dir)))))
            .flat()
            .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));
        const violations = (await Promise.all(files.map(findImplicitClassMembers))).flat();

        // Explicit visibility is a style boundary: public API stays visible in
        // code review, while private/protected extension points are intentional.
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
