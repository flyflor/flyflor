import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { templatesAssetName } from "./installer.planner.ts";

interface TemplateCopyPlan {
    destination: string;
    source: string;
}

/**
 * Builds the release template tarball consumed by scripts/install.sh.
 *
 * The archive is extracted directly into the install prefix, so its root must
 * mirror ~/.flyflor exactly: prompts/, templates/memory/, templates/projects/
 * and commands.jsonc. Keeping this layout in one release script prevents the
 * curl-pipe installer and source install path from drifting apart.
 */
class ReleaseTemplatePackager {
    private readonly repoRoot = join(import.meta.dir, "..");
    private readonly stagingRoot = join(this.repoRoot, "dist", ".release.templates");
    private readonly outputPath: string;

    public constructor(args: string[]) {
        this.outputPath = this.readOutputPath(args);
    }

    public async run(): Promise<void> {
        try {
            await this.resetStagingRoot();
            await this.copyTemplateLayout();
            await this.createTarball();
            await this.assertTarball();
            console.log(`release templates -> ${this.outputPath}`);
        } finally {
            await this.cleanupStagingRoot();
        }
    }

    private readOutputPath(args: string[]): string {
        const outFlag = "--out";
        const outPrefix = `${outFlag}=`;
        const direct = args.find((arg) => arg.startsWith(outPrefix));
        if (direct) {
            const value = direct.slice(outPrefix.length);
            if (!value) {
                throw new Error("--out requires a path");
            }
            return value;
        }
        const index = args.indexOf(outFlag);
        if (index >= 0) {
            const value = args[index + 1];
            if (!value) {
                throw new Error("--out requires a path");
            }
            return value;
        }
        return join(this.repoRoot, "dist", templatesAssetName());
    }

    private async resetStagingRoot(): Promise<void> {
        await rm(this.stagingRoot, { force: true, recursive: true });
        await mkdir(this.stagingRoot, { recursive: true });
        await mkdir(dirname(this.outputPath), { recursive: true });
        await rm(this.outputPath, { force: true });
    }

    private async cleanupStagingRoot(): Promise<void> {
        await rm(this.stagingRoot, { force: true, recursive: true });
    }

    private async copyTemplateLayout(): Promise<void> {
        const plans: TemplateCopyPlan[] = [
            {
                destination: join(this.stagingRoot, "prompts"),
                source: join(this.repoRoot, "templates", "prompts"),
            },
            {
                destination: join(this.stagingRoot, "templates", "memory"),
                source: join(this.repoRoot, "templates", "memory"),
            },
            {
                destination: join(this.stagingRoot, "templates", "projects"),
                source: join(this.repoRoot, "templates", "projects"),
            },
        ];
        for (const plan of plans) {
            await this.copyDirectoryFiles(plan);
        }
        await copyFile(join(this.repoRoot, "templates", "app.commands.jsonc"), join(this.stagingRoot, "commands.jsonc"));
    }

    private async copyDirectoryFiles(plan: TemplateCopyPlan): Promise<void> {
        await mkdir(plan.destination, { recursive: true });
        const entries = await readdir(plan.source, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }
            await copyFile(join(plan.source, entry.name), join(plan.destination, entry.name));
        }
    }

    private async createTarball(): Promise<void> {
        const subprocess = Bun.spawn(["tar", "-czf", this.outputPath, "-C", this.stagingRoot, "."], {
            stderr: "pipe",
            stdout: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([new Response(subprocess.stderr).text(), subprocess.exited]);
        if (exitCode !== 0) {
            throw new Error(`tar failed: ${stderr}`);
        }
    }

    private async assertTarball(): Promise<void> {
        const tarball = Bun.file(this.outputPath);
        if (!(await tarball.exists()) || tarball.size === 0) {
            throw new Error(`Missing release template artifact: ${this.outputPath}`);
        }
    }
}

await new ReleaseTemplatePackager(process.argv.slice(2)).run();
