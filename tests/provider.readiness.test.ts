import { describe, expect, test } from "bun:test";
import { loadProviderReadinessReport } from "../scripts/provider.readiness.ts";

describe("provider readiness script", () => {
    test("default source-mode report points at the repo .config and surfaces readiness state", async () => {
        const report = await loadProviderReadinessReport();

        expect(report.mode).toBe("home");
        expect(report.paths.configDir).toContain("/flyflor/.config");
        expect(report.provider.providerId.length).toBeGreaterThan(0);
        expect(report.provider.model.length).toBeGreaterThan(0);
        expect(["missing", "placeholder", "configured"]).toContain(report.provider.state);
        expect(report.provider.detail).toBe(report.provider.state);
        expect(report.ok).toBe(report.provider.state === "configured");
    });

    test("docker report points at docker/config and preserves readiness semantics", async () => {
        const report = await loadProviderReadinessReport({ docker: true });

        expect(report.mode).toBe("docker");
        expect(report.paths.configDir).toContain("/docker/config");
        expect(report.provider.providerId.length).toBeGreaterThan(0);
        expect(report.provider.model.length).toBeGreaterThan(0);
        expect(["missing", "placeholder", "configured"]).toContain(report.provider.state);
        expect(report.provider.detail).toBe(report.provider.state);
        expect(report.ok).toBe(report.provider.state === "configured");
    });
});
