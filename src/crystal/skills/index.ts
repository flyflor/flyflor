import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";

export interface Skill {
    name: string;
    description: string;
    body: string;
    path: string;
}

export async function loadSkills(paths: FlyflorPaths): Promise<Skill[]> {
    const roots = [join(paths.workspaceDir, "skills"), join(paths.workspaceDir, ".agents", "skills"), paths.skillDir];

    const skills = await Promise.all(roots.map((root) => loadSkillsFromRoot(root)));
    return dedupeSkills(skills.flat());
}

export function selectSkills(skills: Skill[], text: string, limit = 4): Skill[] {
    const lower = text.toLowerCase();
    const scored = skills.map((skill) => {
        const nameHit = lower.includes(skill.name.toLowerCase()) ? 2 : 0;
        const descriptionHit = skill.description
            .toLowerCase()
            .split(/\W+/)
            .filter((word) => word.length >= 4 && lower.includes(word)).length;
        return { skill, score: nameHit + descriptionHit };
    });

    const matched = scored
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.skill);

    return (matched.length > 0 ? matched : skills).slice(0, limit);
}

async function loadSkillsFromRoot(root: string): Promise<Skill[]> {
    try {
        const entries = await readdir(root, { withFileTypes: true });
        const skillFiles = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(root, entry.name, "SKILL.md"));

        const loaded = await Promise.all(skillFiles.map((path) => loadSkill(path)));
        return loaded.filter((skill): skill is Skill => skill !== undefined);
    } catch {
        return [];
    }
}

async function loadSkill(path: string): Promise<Skill | undefined> {
    const file = Bun.file(path);
    if (!(await file.exists())) {
        return undefined;
    }

    const text = await file.text();
    const parsed = parseSkillMarkdown(text);
    if (!parsed.name || !parsed.description) {
        return undefined;
    }

    return {
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
        path,
    };
}

function parseSkillMarkdown(text: string): { name?: string; description?: string; body: string } {
    if (!text.startsWith("---\n")) {
        return { body: text };
    }

    const end = text.indexOf("\n---", 4);
    if (end < 0) {
        return { body: text };
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
        body,
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
