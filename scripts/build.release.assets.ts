import { templatesAssetName } from "./installer.planner.ts";

/**
 * Release asset builder.
 *
 * GitHub Releases must contain every asset the installer downloads. This runner
 * keeps the package.json command short while checking binaries and template
 * tarball together as one publishable set.
 */
class ReleaseAssetBuilder {
    private readonly expectedArtifacts = [
        "dist/flyflor",
        "dist/flyflor-linux-x64",
        "dist/flyflor-linux-arm64",
        `dist/${templatesAssetName()}`,
    ];

    private readonly commands: string[][] = [
        ["bun", "run", "build:binary:release"],
        ["bun", "run", "build:templates:release"],
    ];

    public async run(): Promise<void> {
        for (const command of this.commands) {
            console.log(`\n$ ${command.join(" ")}`);
            const subprocess = Bun.spawn(command, {
                stderr: "inherit",
                stdout: "inherit",
            });
            const code = await subprocess.exited;
            if (code !== 0) {
                process.exit(code);
            }
        }
        await this.assertArtifacts();
    }

    private async assertArtifacts(): Promise<void> {
        for (const path of this.expectedArtifacts) {
            const file = Bun.file(path);
            if (!(await file.exists()) || file.size === 0) {
                console.error(`Missing release artifact: ${path}`);
                process.exit(1);
            }
        }
    }
}

await new ReleaseAssetBuilder().run();
