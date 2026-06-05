import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

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
const CONTAINER_SOURCE_FILE = join('src', 'core', 'ioc', 'ioc.container.ts');

/** The red-line checker itself defines the `.zh.cn.md` reference pattern; it must be self-exempted. */
const SELF_CHECK_FILE = 'scripts/check.script.ts';

/** Type-only declarations containing `new` are not runtime construction sites. */
const TYPE_DECLARATION_PATTERN = /^\s*(export\s+)?type\s+/;

/** Single-line comments cannot be runtime construction sites. */
const COMMENT_LINE_PATTERN = /^\s*(\/\/|\*)/;

/** Runtime construction expression matcher. */
const NEW_EXPRESSION_PATTERN = /\bnew\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

/** Suffix used by the project for Chinese prompt mirrors that the runtime never reads. */
const ZH_MIRROR_SUFFIX = '.zh.cn.md';

/** Suffix for the canonical English prompt source the runtime reads. */
const EN_CANONICAL_SUFFIX = '.md';

/** Directory under version control from which all prompt files originate. */
const PROMPTS_DIR = 'prompts';

/** Pattern that flags any code reference to a Chinese prompt mirror. */
const ZH_MIRROR_REFERENCE_PATTERN = /\.zh\.cn\.md/g;

/** Project file names follow Angular/Nest-style dotted roles, with barrel `index.ts` as the only bare name. */
const DOTTED_TYPESCRIPT_FILENAME_PATTERN = /^(index|[a-z0-9-]+(?:\.[a-z0-9-]+)+)\.ts$/;

/** Exported function APIs are reserved for composition/decorator/bootstrap/check surfaces, not business logic. */
const EXPORTED_FUNCTION_PATTERN = /^\s*export\s+(async\s+)?function\s+/;

/** Files that may expose function-style composition APIs, decorators, or low-level core helpers by design. */
const FUNCTION_EXPORT_FILE_PATTERN = /(^|\/)(index|main\.bootstrap|.*\.composition|.*\.decorator|.*\.configuration|.*\.format|.*\.writer|ioc\.container|check\.script)\.ts$/;

const violations: CheckViolation[] = [];

for (const dir of SCAN_DIRS) {
    scanDirectory(join(process.cwd(), dir));
}
scanPromptTwinRule();

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
            scanFileName(path);
            scanFile(path);
        }
    }
}

/**
 * Enforces code-first Angular/Nest-style file naming: class-bearing files use `name.role.ts`,
 * while `index.ts` remains the only barrel exception.
 * @param path - Absolute TypeScript file path.
 */
function scanFileName(path: string): void {
    const relativePath = relative(process.cwd(), path);
    const fileName = relativePath.split(sep).pop() ?? relativePath;
    if (DOTTED_TYPESCRIPT_FILENAME_PATTERN.test(fileName)) {
        return;
    }
    violations.push({
        file: relativePath,
        line: 1,
        message: 'file name must use Angular/Nest-style dotted naming such as name.service.ts; only index.ts is exempt',
    });
}

/**
 * Scans one TypeScript file for disallowed runtime `new` expressions and any reference to a
 * `.zh.cn.md` prompt mirror (which the runtime must never touch, per AGENTS.md red line 5).
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
        for (const match of line.matchAll(ZH_MIRROR_REFERENCE_PATTERN)) {
            if (relativePath === SELF_CHECK_FILE) {
                continue;
            }
            violations.push({
                file: relativePath,
                line: index + 1,
                message: `disallowed reference to a Chinese prompt mirror '${match[0]}' (AGENTS.md red line 5: runtime reads only the English .md source)`,
            });
        }
        if (EXPORTED_FUNCTION_PATTERN.test(line) && !FUNCTION_EXPORT_FILE_PATTERN.test(relativePath)) {
            violations.push({
                file: relativePath,
                line: index + 1,
                message: 'exported function APIs are reserved for composition/decorator/bootstrap/check files; use OOP class boundaries for business code',
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

/**
 * Walks the `prompts/` tree and verifies the AGENTS.md red-line 5 invariant: every `.md` has a
 * `.zh.cn.md` sibling and vice versa. A missing twin is reported with the canonical file path
 * so the developer can fix the pairing without guessing.
 */
function scanPromptTwinRule(): void {
    const root = join(process.cwd(), PROMPTS_DIR);
    if (!existsDir(root)) {
        return;
    }
    const twins = new Map<string, { en?: string; zh?: string }>();
    collectPromptTwins(root, '', twins);
    for (const [stem, pair] of twins) {
        if (pair.en === undefined) {
            violations.push({
                file: join(PROMPTS_DIR, pair.zh ?? `${stem}${ZH_MIRROR_SUFFIX}`),
                line: 1,
                message: `prompt twin missing: '${stem}${EN_CANONICAL_SUFFIX}' has no English canonical sibling (AGENTS.md red line 5)`,
            });
        }
        if (pair.zh === undefined) {
            violations.push({
                file: join(PROMPTS_DIR, pair.en ?? `${stem}${EN_CANONICAL_SUFFIX}`),
                line: 1,
                message: `prompt twin missing: '${stem}${EN_CANONICAL_SUFFIX}' has no '${ZH_MIRROR_SUFFIX}' mirror (AGENTS.md red line 5)`,
            });
        }
    }
}

/**
 * Recursively walks the `prompts/` tree and records canonical/mirror file pairs by stem name.
 * @param root - Absolute path of the `prompts/` root.
 * @param subdir - Subdirectory path relative to `root` (used as the entry's `stem`).
 * @param twins - Map of stem → { en, zh } paths that the walker fills in.
 */
function collectPromptTwins(root: string, subdir: string, twins: Map<string, { en?: string; zh?: string }>): void {
    const absolute = join(root, subdir);
    for (const entry of readdirSync(absolute)) {
        const entryRelative = subdir.length === 0 ? entry : join(subdir, entry);
        const entryAbsolute = join(absolute, entry);
        const stat = statSync(entryAbsolute);
        if (stat.isDirectory()) {
            collectPromptTwins(root, entryRelative, twins);
            continue;
        }
        if (entry.endsWith(ZH_MIRROR_SUFFIX)) {
            const stem = subdir.length === 0
                ? entry.slice(0, -ZH_MIRROR_SUFFIX.length)
                : join(subdir, entry.slice(0, -ZH_MIRROR_SUFFIX.length));
            const slot = twins.get(stem) ?? {};
            slot.zh = entryRelative.split(sep).join('/');
            twins.set(stem, slot);
            continue;
        }
        if (entry.endsWith(EN_CANONICAL_SUFFIX)) {
            const stem = subdir.length === 0
                ? entry.slice(0, -EN_CANONICAL_SUFFIX.length)
                : join(subdir, entry.slice(0, -EN_CANONICAL_SUFFIX.length));
            const slot = twins.get(stem) ?? {};
            slot.en = entryRelative.split(sep).join('/');
            twins.set(stem, slot);
        }
    }
}

/**
 * Returns whether a directory exists at the given absolute path.
 * @param path - Absolute path to check.
 */
function existsDir(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}
