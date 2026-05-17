import { describe, expect, test } from "bun:test";

describe("agent functional smoke", () => {
    test("runs the deterministic runtime + memory + planning hot-path probe", async () => {
        const proc = Bun.spawn(["bun", "run", "scripts/agent.functional.smoke.ts"], {
            stderr: "pipe",
            stdout: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        const report = JSON.parse(stdout) as {
            brainEvents: number;
            contextForks: number;
            ok: boolean;
            replyText: string;
            sceneRecords: number;
            taskPlans: number;
        };
        expect(report).toMatchObject({
            contextForks: 1,
            ok: true,
            replyText: "Agent functional smoke completed.",
            sceneRecords: 1,
            taskPlans: 1,
        });
        expect(report.brainEvents).toBeGreaterThanOrEqual(1);
    });

    test("package and quality gates keep the agent smoke wired", async () => {
        const packageJson = JSON.parse(await Bun.file("package.json").text()) as { scripts?: Record<string, string> };
        const quality = await Bun.file("scripts/quality.ts").text();

        expect(packageJson.scripts?.["smoke:agent"]).toContain("agent.functional.smoke.ts");
        expect(quality).toContain('["bun", "run", "smoke:agent"]');
    });
});
