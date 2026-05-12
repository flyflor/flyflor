import { describe, expect, test } from "bun:test";
import { selectSkills, SKILL_MANIFEST_SCHEMA_VERSION, type Skill, type SkillUsageSummary } from "../src/crystal/skills/index.ts";

function makeSkill(name: string, opts: Partial<Skill["manifest"]> = {}): Skill {
    return {
        name,
        description: name,
        body: "",
        path: `/skills/${name}.md`,
        root: "/skills",
        source: "project",
        manifest: {
            name,
            description: name,
            capabilities: [],
            compatibility: [],
            mcpServers: [],
            permissions: [],
            schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
            sourceFiles: [],
            tags: [],
            ...opts,
        },
    };
}

describe("selectSkills ranking", () => {
    test("returns first N when no usage info (alphabetical tiebreak)", () => {
        const skills = [makeSkill("delta"), makeSkill("alpha"), makeSkill("beta"), makeSkill("gamma"), makeSkill("epsilon")];
        const picked = selectSkills(skills, { limit: 3 });
        expect(picked.map((s) => s.name)).toEqual(["alpha", "beta", "delta"]);
    });

    test("usage stats outrank unused skills, ties broken by recency", () => {
        const now = Date.parse("2024-06-10T00:00:00Z");
        const skills = [makeSkill("popular"), makeSkill("stale"), makeSkill("fresh"), makeSkill("unused")];
        const usage: SkillUsageSummary = {
            schemaVersion: 1,
            projectDir: "/p",
            skills: {
                popular: {
                    capabilities: [],
                    compatibility: [],
                    firstUsedAt: "2024-05-01T00:00:00Z",
                    lastUsedAt: "2024-06-09T00:00:00Z",
                    mcpCallCount: 10,
                    mcpSuccessCount: 9,
                    source: "project",
                    useCount: 50,
                },
                fresh: {
                    capabilities: [],
                    compatibility: [],
                    firstUsedAt: "2024-06-09T00:00:00Z",
                    lastUsedAt: "2024-06-09T20:00:00Z",
                    mcpCallCount: 0,
                    mcpSuccessCount: 0,
                    source: "project",
                    useCount: 2,
                },
                stale: {
                    capabilities: [],
                    compatibility: [],
                    firstUsedAt: "2024-01-01T00:00:00Z",
                    lastUsedAt: "2024-02-01T00:00:00Z",
                    mcpCallCount: 0,
                    mcpSuccessCount: 0,
                    source: "project",
                    useCount: 3,
                },
            },
        };
        const picked = selectSkills(skills, { limit: 4, usage, now });
        expect(picked[0]?.name).toBe("popular");
        expect(picked.indexOf(skills.find((s) => s.name === "fresh")!)).toBeLessThan(
            picked.indexOf(skills.find((s) => s.name === "stale")!),
        );
        expect(picked.map((s) => s.name)).toContain("unused");
    });

    test("activation.auto: false excludes skill from automatic pool", () => {
        const skills = [makeSkill("auto-on"), makeSkill("manual", { activation: { auto: false } })];
        const picked = selectSkills(skills);
        expect(picked.map((s) => s.name)).toEqual(["auto-on"]);
    });

    test("legacy numeric limit signature still works", () => {
        const skills = [makeSkill("a"), makeSkill("b"), makeSkill("c")];
        expect(selectSkills(skills, 2).map((s) => s.name)).toEqual(["a", "b"]);
    });
});
