import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * One source-location violation reported by the project red-line checker.
 */
interface CheckViolation {
    file: string;
    line: number;
    message: string;
}

/** Directories scanned for Flyflor TypeScript source. */
const SCAN_DIRS = ['src', 'scripts'] as const;

/** Directories that are generated, external, or not part of source red-line checks. */
const SKIPPED_DIR_NAMES = new Set(['node_modules', 'dist', '.agents']);

/** Built-in constructors and the single IOC construction entry allowed by the repository rules. */
const ALLOWED_NEW_TARGETS = new Set(['Container', 'Date', 'Error', 'Map', 'Response', 'Set', 'TextDecoder']);

/** Container internals are the repository's only custom-class construction entry. */
const CONTAINER_SOURCE_FILE = join('src', 'core', 'ioc', 'container.ts');

/** Type-only declarations containing `new` are not runtime construction sites. */
const TYPE_DECLARATION_PATTERN = /^\s*(export\s+)?type\s+/;

/** Single-line comments cannot be runtime construction sites. */
const COMMENT_LINE_PATTERN = /^\s*(\/\/|\*)/;

/** Runtime construction expression matcher. */
const NEW_EXPRESSION_PATTERN = /\bnew\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

const violations: CheckViolation[] = [];

for (const dir of SCAN_DIRS) {
    scanDirectory(join(process.cwd(), dir));
}

if (violations.length > 0) {
    for (const violation of violations) {
        console.error(`${violation.file}:${violation.line} ${violation.message}`);
    }
    process.exit(1);
}

console.log('[check] red-line scan passed');

/**
 * Recursively scans a directory for TypeScript source files.
 * @param dir - Absolute directory path to scan.
 */
function scanDirectory(dir: string): void {
    for (const entry of readdirSync(dir)) {
        if (SKIPPED_DIR_NAMES.has(entry)) {
            continue;
        }
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            scanDirectory(path);
            continue;
        }
        if (path.endsWith('.ts')) {
            scanFile(path);
        }
    }
}

/**
 * Scans one TypeScript file for disallowed runtime `new` expressions.
 * @param path - Absolute file path to scan.
 */
function scanFile(path: string): void {
    const relativePath = relative(process.cwd(), path);
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
        if (TYPE_DECLARATION_PATTERN.test(line) || COMMENT_LINE_PATTERN.test(line)) {
            return;
        }
        for (const match of line.matchAll(NEW_EXPRESSION_PATTERN)) {
            const target = match[1];
            if (target !== undefined && isAllowedNewTarget(relativePath, target)) {
                continue;
            }
            violations.push({
                file: relativePath,
                line: index + 1,
                message: `disallowed runtime constructor call: ${target ?? 'unknown'}`,
            });
        }
    });
}

/**
 * Decides whether a `new` target is allowed by Flyflor's current red-line policy.
 * @param file - Repo-relative file path containing the expression.
 * @param target - Constructor identifier following the `new` keyword.
 * @returns Whether the construction site is permitted.
 */
function isAllowedNewTarget(file: string, target: string): boolean {
    if (ALLOWED_NEW_TARGETS.has(target)) {
        return true;
    }
    return file === CONTAINER_SOURCE_FILE && target === 'Module';
}
