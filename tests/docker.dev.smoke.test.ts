import { describe, expect, test } from "bun:test";
import { runDockerDevSmoke } from "../scripts/docker.dev.smoke.ts";

const DOCKER_RUNTIME_STATE_FILES = [
    "docker/workspace/.flyflor/memory/events.jsonl",
    "docker/workspace/.flyflor/memory/manifest.json",
    "docker/workspace/.flyflor/memory/recalls.jsonl",
    "docker/workspace/.flyflor/skills/skill.usage.summary.json",
] as const;

describe("Docker dev smoke", () => {
    test("dev compose and prompt bundle are release-smoke ready", async () => {
        const checks = await runDockerDevSmoke();
        const failed = checks.filter((check) => !check.ok);

        expect(failed).toEqual([]);
        expect(checks.map((check) => check.name)).toContain("compose exposes no host ports");
        expect(checks.map((check) => check.name)).toContain("docker prompt manifest matches runtime");
    });

    test("docker workspace runtime state stays ignored and untracked", async () => {
        const ignoreProc = Bun.spawn(["git", "check-ignore", ...DOCKER_RUNTIME_STATE_FILES], {
            stdout: "pipe",
            stderr: "pipe",
        });
        const ignored = (await new Response(ignoreProc.stdout).text()).trim().split("\n").filter(Boolean);
        expect(await ignoreProc.exited).toBe(0);
        expect(ignored.sort()).toEqual([...DOCKER_RUNTIME_STATE_FILES].sort());

        // Git tracking is the part .gitignore cannot fix after a file has been
        // committed once; keep this regression test so dev compose smoke runs
        // cannot reintroduce generated memory/skill state into commits.
        const proc = Bun.spawn(["git", "ls-files", ...DOCKER_RUNTIME_STATE_FILES], {
            stdout: "pipe",
            stderr: "pipe",
        });
        const tracked = (await new Response(proc.stdout).text()).trim();
        expect(await proc.exited).toBe(0);
        expect(tracked).toBe("");
    });
});
