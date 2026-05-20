import { describe, expect, test } from "bun:test";
import {
    buildDockerRuntimeSmokePlan,
    isProviderCredentialReady,
    readDoctorApiKeyState,
} from "../scripts/docker.runtime.smoke.ts";

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

    test("can require configured provider credentials before live chat probes", () => {
        const plan = buildDockerRuntimeSmokePlan({
            chatProbe: true,
            devContainerName: "flyflor-dev-test",
        });

        expect(plan.map((step) => step.name)).toEqual([
            "dev doctor",
            "status main path",
            "provider chat probe",
        ]);
        expect(plan[0]?.check?.(doctorLine("warn", "placeholder"))).toBe(false);
        expect(plan[0]?.check?.(doctorLine("ok", "configured"))).toBe(true);
        expect(plan[2]?.command.join(" ")).toContain("flyflor -z");
    });

    test("parses provider credential state from doctor table output", () => {
        expect(readDoctorApiKeyState(doctorLine("warn", "placeholder"))).toEqual({
            status: "warn",
            detail: "placeholder",
        });
    });

    test("provider readiness helper only accepts configured credentials", () => {
        expect(isProviderCredentialReady(readDoctorApiKeyState(doctorLine("warn", "placeholder")))).toBe(false);
        expect(isProviderCredentialReady(readDoctorApiKeyState(doctorLine("ok", "configured")))).toBe(true);
        expect(isProviderCredentialReady(undefined)).toBe(false);
    });
});

function doctorLine(status: string, detail: string): string {
    return [
        "┌─────────┬────────┬─────────────┐",
        `│ API key │ ${status}   │ ${detail} │`,
        "└─────────┴────────┴─────────────┘",
    ].join("\n");
}
