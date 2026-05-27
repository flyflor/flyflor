import { describe, expect, test } from "bun:test";
import { BrowserUrlSafetyPolicy } from "../scripts/browser.url.safety.ts";

describe("BrowserUrlSafetyPolicy", () => {
    test("blocks hostnames that resolve to metadata link-local addresses", async () => {
        const policy = new BrowserUrlSafetyPolicy(async (hostname) => {
            expect(hostname).toBe("agent-controlled.example");
            return ["169.254.169.254"];
        });

        await expect(policy.requiredUrl("https://agent-controlled.example/path", "input.url"))
            .rejects.toThrow("agent-controlled.example -> 169.254.169.254");
    });

    test("allows DNS failures for non-sentinel hostnames", async () => {
        const policy = new BrowserUrlSafetyPolicy(async () => {
            throw new Error("dns unavailable");
        });

        await expect(policy.requiredUrl("https://ordinary.example/path", "input.url"))
            .resolves.toBe("https://ordinary.example/path");
    });

    test("keeps the cloud metadata hostname floor independent from DNS", async () => {
        const policy = new BrowserUrlSafetyPolicy(async () => {
            throw new Error("should not resolve sentinel hostname");
        });

        await expect(policy.requiredUrl("http://metadata.google.internal/computeMetadata/v1/", "input.url"))
            .rejects.toThrow("metadata.google.internal");
    });
});
