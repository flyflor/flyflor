import { describe, expect, test } from "bun:test";
import { runDockerDevSmoke } from "../scripts/docker.dev.smoke.ts";

describe("Docker dev smoke", () => {
    test("dev compose and prompt bundle are release-smoke ready", async () => {
        const checks = await runDockerDevSmoke();
        const failed = checks.filter((check) => !check.ok);

        expect(failed).toEqual([]);
        expect(checks.map((check) => check.name)).toContain("compose exposes no host ports");
        expect(checks.map((check) => check.name)).toContain("docker prompt manifest matches runtime");
    });
});
