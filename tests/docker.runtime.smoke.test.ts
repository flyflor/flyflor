import { describe, expect, test } from "bun:test";
import { buildDockerRuntimeSmokePlan } from "../scripts/docker.runtime.smoke.ts";

describe("Docker runtime smoke plan", () => {
    test("covers doctor, Redis, SurrealDB, and chat main path", () => {
        const plan = buildDockerRuntimeSmokePlan({
            devContainerName: "flyflor-dev-test",
            dockerNetwork: "flyflor-test-network",
            repoRoot: "/repo",
        });

        expect(plan.map((step) => step.name)).toEqual([
            "dev doctor",
            "redis smoke",
            "surreal smoke",
            "chat main path",
        ]);
        expect(plan[0]?.command).toContain("flyflor-dev-test");
        expect(plan[0]?.retries).toBeGreaterThan(0);
        expect(plan[1]?.command).toContain("flyflor-test-network");
        expect(plan[1]?.command.join(" ")).toContain("scripts/redis.smoke.ts");
        expect(plan[2]?.command.join(" ")).toContain("scripts/surreal.smoke.ts");
        expect(plan[3]?.command.join(" ")).toContain("--query runtime smoke");
        expect(plan[3]?.command.join(" ")).not.toContain("--provider");
        expect(plan[3]?.command.join(" ")).not.toContain("--model");
    });
});
