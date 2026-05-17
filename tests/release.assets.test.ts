import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { templatesAssetName } from "../scripts/installer.planner.ts";

const ROOT = join(import.meta.dir, "..");
const PACKAGE_JSON = join(ROOT, "package.json");
const QUALITY_SCRIPT = join(ROOT, "scripts", "quality.ts");

describe("release assets", () => {
    test("template packager creates the installer tarball layout", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-release-assets-"));
        const tarball = join(root, templatesAssetName());
        const proc = Bun.spawn(["bun", "run", "scripts/build.release.templates.ts", "--out", tarball], {
            stderr: "pipe",
            stdout: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(Bun.file(tarball).size).toBeGreaterThan(0);

        const entries = await new ReleaseTarballProbe(tarball).listEntries();
        expect(entries).toContain("commands.jsonc");
        expect(entries).toContain("prompts/runtime.system.md");
        expect(entries).toContain("prompts/template.manifest.json");
        expect(entries).toContain("templates/memory/MEMORY.md");
        expect(entries).toContain("templates/projects/AGENTS.md");
    });

    test("template packager rejects an empty output path", async () => {
        const proc = Bun.spawn(["bun", "run", "scripts/build.release.templates.ts", "--out="], {
            stderr: "pipe",
            stdout: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("--out requires a path");
    });

    test("package scripts expose one release asset gate", async () => {
        const packageJson = JSON.parse(await Bun.file(PACKAGE_JSON).text()) as {
            scripts?: Record<string, string>;
        };
        expect(packageJson.scripts?.["build:templates:release"]).toContain("build.release.templates.ts");
        expect(packageJson.scripts?.["build:release"]).toContain("build.release.assets.ts");
        expect(packageJson.scripts?.["smoke:release"]).toContain("quality.ts release");

        const quality = await Bun.file(QUALITY_SCRIPT).text();
        expect(quality).toContain('["bun", "run", "build:release"]');
    });
});

class ReleaseTarballProbe {
    public constructor(private readonly tarball: string) {}

    public async listEntries(): Promise<string[]> {
        const proc = Bun.spawn(["tar", "-tzf", this.tarball], {
            stderr: "pipe",
            stdout: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        if (exitCode !== 0) {
            throw new Error(`tar list failed: ${stderr}`);
        }
        return stdout
            .split("\n")
            .map((entry) => entry.trim().replace(/^\.\//u, ""))
            .filter(Boolean);
    }
}
