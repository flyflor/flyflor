import { appendFile, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";

export type SkillSource = "project" | "global";

export interface Skill {
    name: string;
    description: string;
    body: string;
    manifest: SkillManifest;
    path: string;
    root: string;
    source: SkillSource;
}

export interface SkillManifest {
    activation?: {
        auto?: boolean;
        manual?: boolean;
    };
    author?: string;
    capabilities: string[];
    compatibility: string[];
    description: string;
    mcpServers: string[];
    name: string;
    permissions: string[];
    schemaVersion: number;
    sourceFiles: string[];
    tags: string[];
    version?: string;
}

export const SKILL_MANIFEST_SCHEMA_VERSION = 1;

export interface SkillValidationResult {
    ok: boolean;
    errors: string[];
    warnings: string[];
    skill?: Skill;
}

export interface SkillRoot {
    root: string;
    source: SkillSource;
}

export interface SkillInstallOptions {
    force?: boolean;
    global?: boolean;
    name?: string;
}

export interface SkillUsageRecord {
    capabilities: string[];
    compatibility: string[];
    mcpCallCount: number;
    mcpSuccessCount: number;
    name: string;
    recordedAt: string;
    requestId?: string;
    source: SkillSource;
}

export interface SkillUsageStats {
    capabilities: string[];
    compatibility: string[];
    firstUsedAt: string;
    lastUsedAt: string;
    mcpCallCount: number;
    mcpSuccessCount: number;
    source: SkillSource;
    useCount: number;
}

export interface SkillUsageSummary {
    schemaVersion: 1;
    projectDir: string;
    updatedAt?: string;
    skills: Record<string, SkillUsageStats>;
}

export interface SkillUsageInput {
    mcpCallCount?: number;
    mcpSuccessCount?: number;
    now: string;
    requestId?: string;
}

export async function loadSkills(paths: FlyflorPaths): Promise<Skill[]> {
    const skills = await Promise.all(skillRoots(paths).map((root) => loadSkillsFromRoot(root)));
    return dedupeSkills(skills.flat());
}

export interface SkillSchemaCompatibilityIssue {
    name: string;
    source: SkillSource;
    schemaVersion: number;
    runtimeVersion: number;
    kind: "older" | "newer";
}

export interface SkillSchemaCompatibilityReport {
    ok: boolean;
    issues: SkillSchemaCompatibilityIssue[];
}

export async function checkSkillSchemaCompatibility(paths: FlyflorPaths): Promise<SkillSchemaCompatibilityReport> {
    const skills = await loadSkills(paths);
    const issues: SkillSchemaCompatibilityIssue[] = [];
    for (const skill of skills) {
        if (skill.manifest.schemaVersion === SKILL_MANIFEST_SCHEMA_VERSION) continue;
        issues.push({
            name: skill.name,
            source: skill.source,
            schemaVersion: skill.manifest.schemaVersion,
            runtimeVersion: SKILL_MANIFEST_SCHEMA_VERSION,
            kind: skill.manifest.schemaVersion > SKILL_MANIFEST_SCHEMA_VERSION ? "newer" : "older",
        });
    }
    return { ok: issues.length === 0, issues };
}

export async function findSkill(paths: FlyflorPaths, name: string): Promise<Skill | undefined> {
    const normalized = name.trim();
    assertSkillName(normalized);
    return (await loadSkills(paths)).find((skill) => skill.name === normalized);
}

export function skillRoots(paths: FlyflorPaths): SkillRoot[] {
    return [
        { root: paths.projectSkillDir, source: "project" },
        { root: paths.skillDir, source: "global" },
    ];
}

export interface SkillSelectionOptions {
    limit?: number;
    usage?: SkillUsageSummary;
    now?: number;
}

export function selectSkills(skills: Skill[], optionsOrLimit: SkillSelectionOptions | number = {}): Skill[] {
    const options: SkillSelectionOptions =
        typeof optionsOrLimit === "number" ? { limit: optionsOrLimit } : optionsOrLimit;
    const limit = options.limit ?? 4;
    const now = options.now ?? Date.now();
    const eligible = skills.filter((skill) => skill.manifest.activation?.auto !== false);
    const scored = eligible.map((skill) => ({
        skill,
        score: scoreSkill(skill, options.usage, now),
    }));
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.skill.name.localeCompare(b.skill.name);
    });
    return scored.slice(0, limit).map((entry) => entry.skill);
}

function scoreSkill(skill: Skill, usage: SkillUsageSummary | undefined, now: number): number {
    const stats = usage?.skills[skill.name];
    if (!stats) return 0;
    let score = Math.log1p(stats.useCount) * 2;
    if (stats.mcpCallCount > 0) {
        score += (stats.mcpSuccessCount / stats.mcpCallCount) * 5;
    }
    const last = Date.parse(stats.lastUsedAt);
    if (Number.isFinite(last)) {
        const ageDays = (now - last) / (24 * 60 * 60 * 1000);
        if (ageDays < 1) score += 3;
        else if (ageDays < 7) score += 2;
        else if (ageDays < 30) score += 1;
    }
    return score;
}

export async function loadSkillUsageSummary(paths: FlyflorPaths): Promise<SkillUsageSummary> {
    const file = Bun.file(skillUsageSummaryPath(paths));
    if (!(await file.exists())) {
        return emptySkillUsageSummary(paths);
    }
    try {
        const parsed = JSON.parse(await file.text()) as unknown;
        if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.skills)) {
            return emptySkillUsageSummary(paths);
        }
        const skills: Record<string, SkillUsageStats> = {};
        for (const [name, value] of Object.entries(parsed.skills)) {
            const stats = normalizeUsageStats(value);
            if (stats && isValidSkillName(name)) {
                skills[name] = stats;
            }
        }
        return {
            schemaVersion: 1,
            projectDir: typeof parsed.projectDir === "string" ? parsed.projectDir : paths.projectDir,
            updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
            skills,
        };
    } catch {
        return emptySkillUsageSummary(paths);
    }
}

export async function recordSkillUsage(
    paths: FlyflorPaths,
    skills: Skill[],
    input: SkillUsageInput,
): Promise<SkillUsageSummary> {
    await mkdir(paths.projectSkillDir, { recursive: true });
    const now = new Date(input.now).toISOString();
    const mcpCallCount = Math.max(0, Math.floor(input.mcpCallCount ?? 0));
    const mcpSuccessCount = Math.max(0, Math.floor(input.mcpSuccessCount ?? 0));
    const summary = await loadSkillUsageSummary(paths);
    const records: SkillUsageRecord[] = [];
    for (const skill of dedupeSkills(skills)) {
        const record: SkillUsageRecord = {
            capabilities: skill.manifest.capabilities,
            compatibility: skill.manifest.compatibility,
            mcpCallCount,
            mcpSuccessCount,
            name: skill.name,
            recordedAt: now,
            requestId: input.requestId,
            source: skill.source,
        };
        records.push(record);
        const previous = summary.skills[skill.name];
        summary.skills[skill.name] = {
            capabilities: skill.manifest.capabilities,
            compatibility: skill.manifest.compatibility,
            firstUsedAt: previous?.firstUsedAt ?? now,
            lastUsedAt: now,
            mcpCallCount: (previous?.mcpCallCount ?? 0) + mcpCallCount,
            mcpSuccessCount: (previous?.mcpSuccessCount ?? 0) + mcpSuccessCount,
            source: skill.source,
            useCount: (previous?.useCount ?? 0) + 1,
        };
    }
    summary.updatedAt = now;
    if (records.length > 0) {
        await appendFile(skillUsageJsonlPath(paths), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    }
    await Bun.write(skillUsageSummaryPath(paths), `${JSON.stringify(sortUsageSummary(summary), null, 2)}\n`);
    return summary;
}

export async function installSkill(
    paths: FlyflorPaths,
    identifier: string,
    options: SkillInstallOptions = {},
): Promise<Skill> {
    const sourceDir = await resolveSkillSourceDir(paths, identifier);
    const sourceSkill = await loadSkill(join(sourceDir, "SKILL.md"), sourceDir, "project");
    if (!sourceSkill) {
        throw new Error(`Skill package must contain a valid SKILL.md: ${sourceDir}`);
    }

    const name = options.name?.trim() || sourceSkill.name;
    assertSkillName(name);

    const root = options.global ? paths.skillDir : paths.projectSkillDir;
    const destination = join(root, name);
    await mkdir(root, { recursive: true });

    if (await exists(destination)) {
        if (!options.force) {
            throw new Error(`Skill already exists: ${name}. Re-run with --force to overwrite it.`);
        }
        await rm(destination, { force: true, recursive: true });
    }

    await cp(sourceDir, destination, { recursive: true });
    if (name !== sourceSkill.name) {
        await rewriteSkillName(join(destination, "SKILL.md"), name);
    }

    const installed = await loadSkill(join(destination, "SKILL.md"), root, options.global ? "global" : "project");
    if (!installed) {
        throw new Error(`Installed skill is invalid: ${destination}`);
    }
    return installed;
}

export async function resetSkill(
    paths: FlyflorPaths,
    name: string,
    options: { global?: boolean } = {},
): Promise<{ path: string; removed: boolean }> {
    const normalized = name.trim();
    assertSkillName(normalized);
    const path = join(options.global ? paths.skillDir : paths.projectSkillDir, normalized);
    const removed = await exists(path);
    if (removed) {
        await rm(path, { force: true, recursive: true });
    }
    return { path, removed };
}

export async function validateSkill(paths: FlyflorPaths, name: string): Promise<SkillValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let skill: Skill | undefined;
    try {
        skill = await findSkill(paths, name);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    if (!skill) {
        errors.push(`Skill not found: ${name}`);
        return { ok: false, errors, warnings };
    }
    if (!skill.description.trim()) {
        errors.push("Skill description is required.");
    }
    if (!skill.body.trim()) {
        warnings.push("Skill body is empty.");
    }
    if (skill.body.length > 24_000) {
        warnings.push("Skill body is large and may crowd the runtime prompt.");
    }
    if (skill.manifest.schemaVersion > SKILL_MANIFEST_SCHEMA_VERSION) {
        warnings.push(
            `Skill manifest schemaVersion ${skill.manifest.schemaVersion} is newer than runtime ${SKILL_MANIFEST_SCHEMA_VERSION}; some fields may be ignored. Upgrade flyflor.`,
        );
    } else if (skill.manifest.schemaVersion < SKILL_MANIFEST_SCHEMA_VERSION) {
        warnings.push(
            `Skill manifest schemaVersion ${skill.manifest.schemaVersion} is older than runtime ${SKILL_MANIFEST_SCHEMA_VERSION}; consider re-installing the skill.`,
        );
    }
    return {
        ok: errors.length === 0,
        errors,
        warnings,
        skill,
    };
}

async function loadSkillsFromRoot(entry: SkillRoot): Promise<Skill[]> {
    try {
        const entries = await readdir(entry.root, { withFileTypes: true });
        const skillFiles = entries
            .filter((entry) => entry.isDirectory())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((dirent) => join(entry.root, dirent.name, "SKILL.md"));

        const loaded = await Promise.all(skillFiles.map((path) => loadSkill(path, entry.root, entry.source)));
        return loaded.filter((skill): skill is Skill => skill !== undefined);
    } catch {
        return [];
    }
}

async function loadSkill(path: string, root: string, source: SkillSource): Promise<Skill | undefined> {
    const file = Bun.file(path);
    if (!(await file.exists())) {
        return undefined;
    }

    const text = await file.text();
    const parsed = parseSkillMarkdown(text);
    const packageRoot = dirname(path);
    const manifestOverlay = await readSkillManifestOverlay(packageRoot);
    const manifest = buildSkillManifest(parsed, manifestOverlay);
    if (!manifest.name || !manifest.description) {
        return undefined;
    }

    return {
        name: manifest.name,
        description: manifest.description,
        body: parsed.body,
        manifest,
        path,
        root,
        source,
    };
}

function parseSkillMarkdown(text: string): {
    body: string;
    frontmatter: Record<string, string>;
    name?: string;
    description?: string;
} {
    if (!text.startsWith("---\n")) {
        return { body: text, frontmatter: {} };
    }

    const end = text.indexOf("\n---", 4);
    if (end < 0) {
        return { body: text, frontmatter: {} };
    }

    const frontmatter = text.slice(4, end).trim();
    const body = text.slice(end + 4).trim();
    const meta: Record<string, string> = {};
    for (const line of frontmatter.split("\n")) {
        const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line.trim());
        if (match) {
            meta[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
        }
    }

    return {
        name: meta.name,
        description: meta.description,
        frontmatter: meta,
        body,
    };
}

async function readSkillManifestOverlay(root: string): Promise<Record<string, unknown>> {
    for (const filename of ["skill.json", "manifest.json"]) {
        const file = Bun.file(join(root, filename));
        if (!(await file.exists())) {
            continue;
        }
        try {
            const parsed = JSON.parse(await file.text()) as unknown;
            return isRecord(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function buildSkillManifest(
    parsed: { frontmatter: Record<string, string>; name?: string; description?: string },
    overlay: Record<string, unknown>,
): SkillManifest {
    const fm = parsed.frontmatter;
    const name = stringValue(overlay.name) ?? parsed.name ?? "";
    const description = stringValue(overlay.description) ?? parsed.description ?? "";
    return {
        activation: activationValue(overlay.activation),
        author: stringValue(overlay.author) ?? stringValue(overlay.maintainer),
        capabilities: uniqueStrings([
            ...listValue(overlay.capabilities),
            ...listValue(fm.capabilities),
            ...listValue(overlay.tools),
        ]),
        compatibility: uniqueStrings([
            ...listValue(overlay.compatibility),
            ...listValue(overlay.compatibleWith),
            ...listValue(overlay.agents),
            ...listValue(fm.compatibility),
            ...listValue(fm.compatibleWith),
        ]),
        description,
        mcpServers: uniqueStrings([
            ...listValue(overlay.mcpServers),
            ...objectKeys(overlay.mcpServers),
            ...listValue(overlay.mcp),
            ...objectKeys(overlay.mcp),
            ...listValue(fm.mcpServers),
        ]),
        name,
        permissions: uniqueStrings([
            ...listValue(overlay.permissions),
            ...objectKeys(overlay.permissions),
            ...listValue(fm.permissions),
        ]),
        schemaVersion: numberValue(overlay.schemaVersion) ?? numberValue(fm.schemaVersion) ?? SKILL_MANIFEST_SCHEMA_VERSION,
        sourceFiles: ["SKILL.md", ...manifestSourceFiles(overlay)],
        tags: uniqueStrings([...listValue(overlay.tags), ...listValue(fm.tags)]),
        version: stringValue(overlay.version) ?? stringValue(fm.version),
    };
}

function manifestSourceFiles(overlay: Record<string, unknown>): string[] {
    return Object.keys(overlay).length === 0 ? [] : ["skill.json|manifest.json"];
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function listValue(value: unknown): string[] {
    if (typeof value === "string") {
        const text = value.trim();
        if (!text) {
            return [];
        }
        if (text.startsWith("[") && text.endsWith("]")) {
            try {
                const parsed = JSON.parse(text) as unknown;
                return listValue(parsed);
            } catch {
                return splitList(text);
            }
        }
        return splitList(text);
    }
    if (Array.isArray(value)) {
        return value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

function splitList(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function objectKeys(value: unknown): string[] {
    return isRecord(value) ? Object.keys(value) : [];
}

function activationValue(value: unknown): SkillManifest["activation"] | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    return {
        auto: typeof value.auto === "boolean" ? value.auto : undefined,
        manual: typeof value.manual === "boolean" ? value.manual : undefined,
    };
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function skillUsageJsonlPath(paths: FlyflorPaths): string {
    return join(paths.projectSkillDir, "skill.usage.jsonl");
}

function skillUsageSummaryPath(paths: FlyflorPaths): string {
    return join(paths.projectSkillDir, "skill.usage.summary.json");
}

function emptySkillUsageSummary(paths: FlyflorPaths): SkillUsageSummary {
    return {
        schemaVersion: 1,
        projectDir: paths.projectDir,
        skills: {},
    };
}

function normalizeUsageStats(value: unknown): SkillUsageStats | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const firstUsedAt = stringValue(value.firstUsedAt);
    const lastUsedAt = stringValue(value.lastUsedAt);
    const source = value.source === "project" || value.source === "global" ? value.source : undefined;
    if (!firstUsedAt || !lastUsedAt || !source) {
        return undefined;
    }
    return {
        capabilities: listValue(value.capabilities),
        compatibility: listValue(value.compatibility),
        firstUsedAt,
        lastUsedAt,
        mcpCallCount: nonNegativeInteger(value.mcpCallCount),
        mcpSuccessCount: nonNegativeInteger(value.mcpSuccessCount),
        source,
        useCount: nonNegativeInteger(value.useCount),
    };
}

function nonNegativeInteger(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sortUsageSummary(summary: SkillUsageSummary): SkillUsageSummary {
    return {
        ...summary,
        skills: Object.fromEntries(Object.entries(summary.skills).sort(([left], [right]) => left.localeCompare(right))),
    };
}

function dedupeSkills(skills: Skill[]): Skill[] {
    const byName = new Map<string, Skill>();
    for (const skill of skills) {
        if (!byName.has(skill.name)) {
            byName.set(skill.name, skill);
        }
    }
    return [...byName.values()];
}

async function resolveSkillSourceDir(paths: FlyflorPaths, identifier: string): Promise<string> {
    const trimmed = identifier.trim();
    if (!trimmed) {
        throw new Error("Skill identifier is required.");
    }

    const localPath = resolve(process.cwd(), trimmed);
    try {
        const info = await stat(localPath);
        if (info.isDirectory()) {
            return localPath;
        }
        if (info.isFile()) {
            return dirname(localPath);
        }
    } catch {
        // Fall through to exact installed-skill lookup.
    }

    const existing = (await loadSkills(paths)).find((skill) => skill.name === trimmed);
    if (existing) {
        return dirname(existing.path);
    }

    throw new Error(`Skill source not found: ${identifier}`);
}

async function rewriteSkillName(path: string, name: string): Promise<void> {
    const file = Bun.file(path);
    const text = await file.text();
    if (!text.startsWith("---\n")) {
        await Bun.write(path, `---\nname: ${name}\n---\n\n${text.trim()}\n`);
        return;
    }
    const end = text.indexOf("\n---", 4);
    if (end < 0) {
        await Bun.write(path, `---\nname: ${name}\n---\n\n${text.trim()}\n`);
        return;
    }
    const frontmatter = text.slice(4, end);
    const body = text.slice(end);
    const lines = frontmatter.split("\n");
    let replaced = false;
    const nextFrontmatter = lines
        .map((line) => {
            if (line.trimStart().startsWith("name:")) {
                replaced = true;
                return `name: ${name}`;
            }
            return line;
        })
        .join("\n");
    await Bun.write(path, `---\n${replaced ? nextFrontmatter : `name: ${name}\n${nextFrontmatter}`}${body}`);
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function assertSkillName(name: string): void {
    if (!isValidSkillName(name)) {
        throw new Error(`Invalid skill name: ${name}`);
    }
}

function isValidSkillName(name: string): boolean {
    return /^[A-Za-z0-9_.-]+$/.test(name);
}
