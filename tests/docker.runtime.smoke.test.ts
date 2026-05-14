import { describe, expect, test } from "bun:test";
import { buildDockerRuntimeSmokePlan } from "../scripts/docker.runtime.smoke.ts";

describe("Docker runtime smoke plan", () => {
    test("covers doctor and status main path without mandatory external backends", () => {
        const plan = buildDockerRuntimeSmokePlan({
            devContainerName: "flyflor-dev-test",
            dockerNetwork: "flyflor-test-network",
            repoRoot: "/repo",
        });

        expect(plan.map((step) => step.name)).toEqual([
            "dev doctor",
            "status main path",
        ]);
        expect(plan[0]?.command).toContain("flyflor-dev-test");
        expect(plan[0]?.retries).toBeGreaterThan(0);
        expect(plan[1]?.command.join(" ")).toContain("flyflor status");
        expect(plan[1]?.command.join(" ")).not.toContain("--provider");
        expect(plan[1]?.command.join(" ")).not.toContain("--model");
    });
});
