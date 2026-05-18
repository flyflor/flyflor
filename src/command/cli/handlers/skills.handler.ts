import {
    findSkill,
    installSkill,
    loadSkills,
    loadSkillUsageSummary,
    resetSkill,
    validateSkill,
    type Skill,
    type SkillUsageSummary,
    type SkillValidationResult as RawSkillValidationResult,
} from "../../../agent/skills/index.ts";
import type { FlyflorPaths } from "../../../config/index.ts";

export interface SkillListItem {
    name: string;
    description: string;
    version: string;
    schemaVersion: string;
    source: string;
}

export interface SkillDetail {
    name: string;
    description: string;
    version: string;
    schemaVersion: string;
    source: string;
    path: string;
    manifest: Record<string, unknown>;
}

export interface SkillValidationView {
    name: string;
    ok: boolean;
    issues: string[];
}

export async function fetchSkillList(paths: FlyflorPaths): Promise<SkillListItem[]> {
    const skills = await loadSkills(paths);
    return skills.map((skill) => ({
        name: skill.name,
        description: skill.description ?? "",
        version: skill.manifest.version ?? "",
        schemaVersion: String(skill.manifest.schemaVersion ?? ""),
        source: skill.source ?? "builtin",
    }));
}

export async function fetchSkillDetail(paths: FlyflorPaths, name: string): Promise<SkillDetail | undefined> {
    const skill = await findSkill(paths, name);
    if (!skill) return undefined;
    return {
        name: skill.name,
        description: skill.description ?? "",
        version: skill.manifest.version ?? "",
        schemaVersion: String(skill.manifest.schemaVersion ?? ""),
        source: skill.source ?? "builtin",
        path: skill.path ?? "",
        manifest: skill.manifest as unknown as Record<string, unknown>,
    };
}

export async function validateSkills(paths: FlyflorPaths, name?: string): Promise<SkillValidationView[]> {
    if (name) {
        const result = await validateSkill(paths, name);
        return [mapValidationResult(name, result)];
    }
    const skills = await loadSkills(paths);
    const results = await Promise.all(
        skills.map(async (skill) => {
            const result = await validateSkill(paths, skill.name);
            return mapValidationResult(skill.name, result);
        }),
    );
    return results;
}

function mapValidationResult(name: string, result: RawSkillValidationResult): SkillValidationView {
    const issues: string[] = [];
    for (const error of result.errors) issues.push(error);
    for (const warning of result.warnings) issues.push(`warn: ${warning}`);
    return { name, ok: result.ok, issues };
}

export async function fetchSkillUsage(paths: FlyflorPaths): Promise<SkillUsageSummary> {
    return loadSkillUsageSummary(paths);
}
