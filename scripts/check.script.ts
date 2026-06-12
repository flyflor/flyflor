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
const ALLOWED_NEW_TARGETS = new Set([
    'AbortController',
    'BehaviorSubject',
    'Bun',
    'Container',
    'Date',
    'Error',
    'Glob',
    'Map',
    'Observable',
    'Promise',
    'ReadableStream',
    'RegExp',
    'Response',
    'Set',
    'TextDecoder',
    'TextEncoder',
    'TransformStream',
]);

/** Container internals are the repository's only custom-class construction entry. */
const CONTAINER_SOURCE_FILE = join('src', 'core', 'ioc', 'container.ts');

/** The red-line checker itself defines the `.zh.cn.md` reference pattern; it must be self-exempted. */
const SELF_CHECK_FILE = 'scripts/check.script.ts';

/** Files that define human-only prompt mirror checks. */
const ZH_MIRROR_REFERENCE_ALLOWED_FILES = new Set([SELF_CHECK_FILE]);

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

/** Markdown documentation directories that must maintain `.zh.cn.md` mirrors recursively. */
const DOCUMENTATION_MIRROR_DIRS = ['docs', 'prompts'] as const;

/** Pattern that flags any code reference to a Chinese prompt mirror. */
const ZH_MIRROR_REFERENCE_PATTERN = /\.zh\.cn\.md/g;

/** Project file names follow Angular/Nest-style dotted roles, with barrel `index.ts` as the default bare name. */
const DOTTED_TYPESCRIPT_FILENAME_PATTERN = /^(index|[a-z0-9-]+(?:\.[a-z0-9-]+)+)\.ts$/;

/** Approved domain directories may use compact role file names. */
const ROLE_TYPESCRIPT_FILENAME_PATTERN = /^(service|types|constants|decorator|factory|container|abstracts|socket)\.ts$/;

/** Explicit directories approved for compact role file names. */
const ROLE_DIRECTORIES = new Set([
    join('src', 'core'),
    join('src', 'core', 'file'),
    join('src', 'core', 'environment'),
    join('src', 'core', 'ioc'),
    join('src', 'core', 'logger'),
    join('src', 'core', 'prompt'),
    join('src', 'tools'),
    join('src', 'agent', 'execution'),
    join('src', 'agent', 'callosal'),
    join('src', 'agent', 'brain', 'intelligence'),
    join('src', 'neural', 'ipc'),
    join('src', 'neural', 'packet'),
]);

/** Existing compact object files are preserved until a dedicated naming migration finalizes the convention. */
const COMPACT_TYPESCRIPT_SOURCE_FILES = new Set([
    join('src', 'agent', 'brain', 'brain.ts'),
    join('src', 'agent', 'brain', 'crystall.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'anthropic-messages.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'aws-bedrock-converse.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'cohere-chat.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'google-gemini-generate-content.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'hugging-face.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'lm-studio.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'ollama.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'openai-chat-completions.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'openai-responses.ts'),
    join('src', 'agent', 'brain', 'intelligence', 'protocols', 'vllm.ts'),
]);

/** Existing non-dotted source files are preserved until a dedicated naming migration happens. */
const LEGACY_TYPESCRIPT_SOURCE_FILES = new Set([
    join('src', 'agent', 'agent.ts'),
    join('src', 'agent', 'types.ts'),
    join('src', 'agent', 'memory.ts'),
    join('src', 'neural', 'synapse.ts'),
    join('src', 'bootstrap.ts'),
    join('src', 'tools', 'ask.ts'),
    join('src', 'tools', 'bash.ts'),
    join('src', 'tools', 'confirm.ts'),
    join('src', 'tools', 'delete.ts'),
    join('src', 'tools', 'edit.ts'),
    join('src', 'tools', 'glob.ts'),
    join('src', 'tools', 'grep.ts'),
    join('src', 'tools', 'module.ts'),
    join('src', 'tools', 'read.ts'),
    join('src', 'tools', 'write.ts'),
]);

/** Exported function APIs are reserved for composition/decorator/bootstrap/check surfaces, not business logic. */
const EXPORTED_FUNCTION_PATTERN = /^\s*export\s+(async\s+)?function\s+/;

/** Files that may expose function-style composition APIs, decorators, or low-level core helpers by design. */
const FUNCTION_EXPORT_FILE_PATTERN = /(^|\/)(index|main\.bootstrap|core\/ioc\/container|core\/logger\/service|.*\.composition|decorator|.*\.decorator|.*\.configuration|.*\.format|.*\.writer|ioc\.container|check\.script)\.ts$/;

const violations: CheckViolation[] = [];

for (const dir of SCAN_DIRS) {
    scanDirectory(join(process.cwd(), dir));
}
scanMarkdownMirrorRule();

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
    if (isApprovedRoleFile(relativePath, fileName)) {
        return;
    }
    if (COMPACT_TYPESCRIPT_SOURCE_FILES.has(relativePath)) {
        return;
    }
    if (LEGACY_TYPESCRIPT_SOURCE_FILES.has(relativePath)) {
        return;
    }
    violations.push({
        file: relativePath,
        line: 1,
        message: 'file name must use Angular/Nest-style dotted naming or an approved core role file name',
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
            if (ZH_MIRROR_REFERENCE_ALLOWED_FILES.has(relativePath)) {
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
 * Allows compact role filenames only in approved core object directories.
 * @param relativePath - Repo-relative TypeScript file path.
 * @param fileName - Basename of the TypeScript file.
 * @returns Whether the file is an approved compact role file.
 */
function isApprovedRoleFile(relativePath: string, fileName: string): boolean {
    if (!ROLE_TYPESCRIPT_FILENAME_PATTERN.test(fileName)) {
        return false;
    }
    return ROLE_DIRECTORIES.has(relativePath.split(sep).slice(0, -1).join(sep));
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
 * Verifies the documentation mirror invariant: every canonical `.md` document has a `.zh.cn.md` sibling
 * and every mirror has a canonical sibling. Runtime code still reads only canonical `.md` files.
 */
function scanMarkdownMirrorRule(): void {
    const twins = new Map<string, { en?: string; zh?: string }>();
    collectTopLevelMarkdownMirrors(twins);
    for (const documentationPath of DOCUMENTATION_MIRROR_DIRS) {
        const absolute = join(process.cwd(), documentationPath);
        if (existsDir(absolute)) {
            collectMarkdownMirrors(documentationPath, twins);
            continue;
        }
    }
    for (const [stem, pair] of twins) {
        if (pair.en === undefined) {
            violations.push({
                file: pair.zh ?? `${stem}${ZH_MIRROR_SUFFIX}`,
                line: 1,
                message: `documentation mirror missing canonical sibling: '${stem}${EN_CANONICAL_SUFFIX}'`,
            });
        }
        if (pair.zh === undefined) {
            violations.push({
                file: pair.en ?? `${stem}${EN_CANONICAL_SUFFIX}`,
                line: 1,
                message: `documentation mirror missing: '${stem}${EN_CANONICAL_SUFFIX}' has no '${ZH_MIRROR_SUFFIX}' sibling`,
            });
        }
    }
}

/**
 * Records root-level markdown documents into the canonical/mirror map.
 * @param twins - Map of stem → { en, zh } paths that the scanner fills in.
 */
function collectTopLevelMarkdownMirrors(twins: Map<string, { en?: string; zh?: string }>): void {
    for (const entry of readdirSync(process.cwd())) {
        const absolute = join(process.cwd(), entry);
        if (!statSync(absolute).isFile() || !entry.endsWith(EN_CANONICAL_SUFFIX)) {
            continue;
        }
        collectMarkdownMirrorFile(entry, twins);
    }
}

/**
 * Recursively walks one documentation directory and records canonical/mirror file pairs by repo-relative stem.
 * @param subdir - Directory path relative to the repo root.
 * @param twins - Map of stem → { en, zh } paths that the walker fills in.
 */
function collectMarkdownMirrors(subdir: string, twins: Map<string, { en?: string; zh?: string }>): void {
    const absolute = join(process.cwd(), subdir);
    for (const entry of readdirSync(absolute)) {
        const entryRelative = subdir.length === 0 ? entry : join(subdir, entry);
        const entryAbsolute = join(process.cwd(), entryRelative);
        const stat = statSync(entryAbsolute);
        if (stat.isDirectory()) {
            collectMarkdownMirrors(entryRelative, twins);
            continue;
        }
        collectMarkdownMirrorFile(entryRelative, twins);
    }
}

/**
 * Records one markdown file into the canonical/mirror map.
 * @param relativePath - Repo-relative markdown file path.
 * @param twins - Map of stem → { en, zh } paths that the scanner fills in.
 */
function collectMarkdownMirrorFile(relativePath: string, twins: Map<string, { en?: string; zh?: string }>): void {
    if (relativePath.endsWith(ZH_MIRROR_SUFFIX)) {
        const stem = relativePath.slice(0, -ZH_MIRROR_SUFFIX.length);
        const slot = twins.get(stem) ?? {};
        slot.zh = relativePath.split(sep).join('/');
        twins.set(stem, slot);
        return;
    }
    if (relativePath.endsWith(EN_CANONICAL_SUFFIX)) {
        const stem = relativePath.slice(0, -EN_CANONICAL_SUFFIX.length);
        const slot = twins.get(stem) ?? {};
        slot.en = relativePath.split(sep).join('/');
        twins.set(stem, slot);
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
