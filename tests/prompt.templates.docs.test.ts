import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPromptTemplatesDoc } from "../src/agent/prompts/template.docs.ts";
import {
    PROMPT_TEMPLATE_BUNDLE_MANIFEST,
    PROMPT_TEMPLATE_BUNDLE_VERSION,
    PROMPT_TEMPLATE_DEFINITIONS,
    PROMPT_TEMPLATE_MANIFEST_FILE,
    PROMPT_TEMPLATE_ORDER,
} from "../src/agent/prompts/template.manifest.ts";
import { BlackboardWorkerProtocol } from "../src/protocol/contracts/index.ts";

describe("prompt template docs generator", () => {
    test("matches the checked-in README section", async () => {
        const generated = renderPromptTemplatesDoc().trimEnd();
        const readme = await readFile(join(import.meta.dir, "..", "README.md"), "utf8");
        const checkedIn = extractPromptTemplateSection(readme);
        expect(generated).toBe(checkedIn);
    });

    test("bundle manifest matches runtime template definitions", async () => {
        const manifestPath = join(import.meta.dir, "..", "templates", "prompts", "template.manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as typeof PROMPT_TEMPLATE_BUNDLE_MANIFEST;
        expect(manifest.schemaVersion).toBe(PROMPT_TEMPLATE_BUNDLE_VERSION);
        expect(manifest).toEqual(PROMPT_TEMPLATE_BUNDLE_MANIFEST);
        expect(manifest.templates.find((entry) => entry.key === "blackboardWorkerEnvelope")?.protocol).toBe(
            BlackboardWorkerProtocol.V1,
        );
        expect(manifest.templates.find((entry) => entry.key === "blackboardWorkerEnvelope")?.protocolSpec).toEqual({
            expectedOutput: [
                "inputSummary",
                "outputSummary",
                "newFacts",
                "blockers",
                "risk",
                "questions",
                "answers",
                "agreement",
                "outcome",
                "openIssues",
                "proposal",
                "discussion",
            ],
            constraints: [
                "no-tool-execution",
                "no-long-term-memory-write",
                "surface-blockers",
                "write-public-discussion-as-dialogue",
                "answer-current-round-peer-questions",
            ],
        });
    });

    test("prompt directory canonical templates match manifest definitions", async () => {
        const promptDir = join(import.meta.dir, "..", "templates", "prompts");
        const actual = (await readdir(promptDir))
            .filter((name) => name.endsWith(".md") || name === PROMPT_TEMPLATE_MANIFEST_FILE)
            .filter((name) => !name.endsWith(".zh.cn.md"))
            .sort();
        const expected = [
            PROMPT_TEMPLATE_MANIFEST_FILE,
            ...PROMPT_TEMPLATE_ORDER.flatMap((key) => {
                const spec = PROMPT_TEMPLATE_DEFINITIONS[key];
                return [spec.filename];
            }),
        ].sort();
        expect(actual).toEqual(expected);
    });

    test("install.templates syncs prompt manifest and canonical templates", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-install-templates-"));
        try {
            const proc = Bun.spawn(["bun", "run", "scripts/install.templates.ts", "--target", root, "--force"], {
                cwd: join(import.meta.dir, ".."),
                stderr: "pipe",
                stdout: "pipe",
            });
            const [exit, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
            expect(stderr).toBe("");
            expect(exit).toBe(0);

            const manifest = JSON.parse(
                await readFile(join(root, "prompts", PROMPT_TEMPLATE_MANIFEST_FILE), "utf8"),
            ) as typeof PROMPT_TEMPLATE_BUNDLE_MANIFEST;
            expect(manifest.schemaVersion).toBe(PROMPT_TEMPLATE_BUNDLE_VERSION);
            expect(manifest).toEqual(PROMPT_TEMPLATE_BUNDLE_MANIFEST);
            for (const key of PROMPT_TEMPLATE_ORDER) {
                const spec = PROMPT_TEMPLATE_DEFINITIONS[key];
                expect(await Bun.file(join(root, "prompts", spec.filename)).exists()).toBe(true);
            }
            expect(await Bun.file(join(root, "commands.jsonc")).exists()).toBe(true);
            expect(await Bun.file(join(root, "commands.jsonc")).text()).toContain('"run"');
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    test("docker template install initializes config once and preserves local secrets", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-docker-templates-"));
        try {
            const first = Bun.spawn(
                ["bun", "run", "scripts/install.templates.ts", "--docker", "--target", root, "--force"],
                {
                    cwd: join(import.meta.dir, ".."),
                    stderr: "pipe",
                    stdout: "pipe",
                },
            );
            expect(await first.exited).toBe(0);
            const configPath = join(root, "config.jsonc");
            const generated = await readFile(configPath, "utf8");
            expect(generated).toContain('"crystal"');
            expect(generated).toContain('"enabled": true');

            await writeFile(configPath, '{ "model": { "providers": { "fastai": { "apiKey": "sk-live" } } } }\n');
            const second = Bun.spawn(
                ["bun", "run", "scripts/install.templates.ts", "--docker", "--target", root, "--force"],
                {
                    cwd: join(import.meta.dir, ".."),
                    stderr: "pipe",
                    stdout: "pipe",
                },
            );
            const [exit, stdout] = await Promise.all([second.exited, new Response(second.stdout).text()]);
            expect(exit).toBe(0);
            expect(stdout).toContain("preserve config.jsonc");
            expect(await readFile(configPath, "utf8")).toContain("sk-live");
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    test("source template install can initialize source config once and preserve local secrets", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-source-templates-"));
        try {
            const first = Bun.spawn(
                ["bun", "run", "scripts/install.templates.ts", "--target", root, "--source-config", "--force"],
                {
                    cwd: join(import.meta.dir, ".."),
                    stderr: "pipe",
                    stdout: "pipe",
                },
            );
            expect(await first.exited).toBe(0);
            const configPath = join(root, "config.jsonc");
            const generated = await readFile(configPath, "utf8");
            expect(generated).toContain('"replace-with-real-key"');
            expect(generated).toContain('"crystal"');

            await writeFile(configPath, '{ "model": { "providers": { "openai": { "apiKey": "test-live-key" } } } }\n');
            const second = Bun.spawn(
                ["bun", "run", "scripts/install.templates.ts", "--target", root, "--source-config", "--force"],
                {
                    cwd: join(import.meta.dir, ".."),
                    stderr: "pipe",
                    stdout: "pipe",
                },
            );
            const [exit, stdout] = await Promise.all([second.exited, new Response(second.stdout).text()]);
            expect(exit).toBe(0);
            expect(stdout).toContain("preserve config.jsonc");
            expect(await readFile(configPath, "utf8")).toContain("test-live-key");
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});

function extractPromptTemplateSection(readme: string): string {
    const startMarker = "<!-- flyflor:prompt-templates:start -->";
    const endMarker = "<!-- flyflor:prompt-templates:end -->";
    const start = readme.indexOf(startMarker);
    const end = readme.indexOf(endMarker);
    if (start === -1 || end === -1 || end < start) {
        throw new Error("README prompt template section markers are missing.");
    }
    return readme.slice(start + startMarker.length, end).trim();
}
