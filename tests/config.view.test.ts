import { describe, expect, test } from "bun:test";
import { isSecretKey, redactSecret, renderConfigView } from "../src/command/config.view.ts";
import type { FlyflorConfig } from "../src/config/index.ts";

const TEST_MODEL_API_KEY = "test-openai-key-abcdef1234567890";

const fakeConfig = (): FlyflorConfig =>
    ({
        paths: {
            home: "/tmp/flyflor",
            storageDir: "/tmp/flyflor/storage",
            memoryDir: "/tmp/flyflor/memory",
            promptDir: "/tmp/flyflor/prompts",
            projectDir: "/tmp/project",
            projectFlyflorDir: "/tmp/project/.flyflor",
            projectMemoryDir: "/tmp/project/.flyflor/memory",
        },
        model: {
            providerId: "openai",
            model: "gpt-4o",
            apiMode: "responses",
            apiKey: TEST_MODEL_API_KEY,
            baseUrl: "https://api.openai.com",
        },
        gateway: {
            host: "127.0.0.1",
            port: 8765,
            allowedChannels: ["telegram", "slack"],
            channels: {
                telegram: { botToken: "1234567890:ABCDEFG_secret_token_value" },
                slack: { botToken: "" },
                empty: {},
            },
        },
        memory: {
            enabled: true,
            crystal: { enabled: true, backend: "local", local: {} },
        },
        sandbox: {
            mode: "off",
            mcpToolApproval: "ask",
            shellHookApproval: "allow",
            pluginApproval: "deny",
        },
    }) as unknown as FlyflorConfig;

describe("config view", () => {
    test("redactSecret keeps prefix/suffix only", () => {
        expect(redactSecret(TEST_MODEL_API_KEY)).toBe("test…90");
        expect(redactSecret("short")).toBe("***");
        expect(redactSecret("")).toBe("(unset)");
    });

    test("isSecretKey detects common patterns", () => {
        expect(isSecretKey("apiKey")).toBe(true);
        expect(isSecretKey("BotToken")).toBe(true);
        expect(isSecretKey("password")).toBe(true);
        expect(isSecretKey("host")).toBe(false);
        expect(isSecretKey("port")).toBe(false);
    });

    test("text view redacts model.apiKey by default", () => {
        const out = renderConfigView(fakeConfig());
        expect(out).toContain("provider: openai");
        expect(out).toContain("model: gpt-4o");
        expect(out).toContain("apiKey: test…90");
        expect(out).toContain("mcpToolApproval: ask");
        expect(out).toContain("shellHookApproval: allow");
        expect(out).toContain("pluginApproval: deny");
        expect(out).not.toContain(TEST_MODEL_API_KEY);
    });

    test("text view shows secrets when redact disabled", () => {
        const out = renderConfigView(fakeConfig(), { redact: false });
        expect(out).toContain(TEST_MODEL_API_KEY);
    });

    test("text view marks channels missing secrets as incomplete", () => {
        const out = renderConfigView(fakeConfig());
        expect(out).toContain("- telegram");
        expect(out).toContain("- slack (incomplete)");
        expect(out).not.toContain("- empty");
        expect(out).not.toContain("1234567890:ABCDEFG_secret_token_value");
    });

    test("json view is parseable and contains redacted secrets", () => {
        const out = renderConfigView(fakeConfig(), { format: "json" });
        const parsed = JSON.parse(out);
        expect(parsed.model.apiKey).toBe("test…90");
        expect(parsed.gateway.allowedChannels).toEqual(["telegram", "slack"]);
        expect(parsed.sandbox).toEqual({
            mode: "off",
            mcpToolApproval: "ask",
            shellHookApproval: "allow",
            pluginApproval: "deny",
        });
        expect(parsed.gateway.configuredChannels.find((c: { name: string }) => c.name === "slack").ready).toBe(false);
        expect(parsed.memory).toEqual({
            enabled: true,
            crystal: true,
            crystalBackend: "local",
            crystalDbFile: "",
        });
    });

    test("json view honors redact=false", () => {
        const out = renderConfigView(fakeConfig(), { format: "json", redact: false });
        const parsed = JSON.parse(out);
        expect(parsed.model.apiKey).toBe(TEST_MODEL_API_KEY);
    });
});
