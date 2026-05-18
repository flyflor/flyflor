/**
 * Runtime skill selection adapter.
 *
 * Explicit skill names come from config/context fields; automatic selection is
 * delegated to the external Skill package index so RuntimeModule does not embed skill
 * policy details in the turn orchestration class.
 */

import {
    selectSkills,
    type Skill,
    type SkillUsageSummary,
} from "../../skills/index.ts";

export function selectRuntimeSkills(
    skills: Skill[],
    requestedNames: string[] | undefined,
    queryEmbedding: number[] | undefined,
    usage: SkillUsageSummary | undefined,
): Skill[] {
    const requested = new Set((requestedNames ?? []).map((name) => name.trim()).filter(Boolean));
    if (requested.size === 0) {
        return selectSkills(skills, { usage, queryEmbedding });
    }

    const explicit = skills.filter((skill) => requested.has(skill.name));
    const explicitNames = new Set(explicit.map((skill) => skill.name));
    const automatic = selectSkills(skills, { usage, queryEmbedding }).filter((skill) => !explicitNames.has(skill.name));
    return [...explicit, ...automatic].slice(0, 4);
}
