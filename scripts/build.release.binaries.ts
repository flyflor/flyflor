/**
 * Release binary builder.
 *
 * Bun skips foreign optional native packages during normal local install. The
 * release build needs OpenTUI's Linux x64 and arm64 native packages present so
 * `bun build --compile --target=bun-linux-*` can resolve the target import.
 */
class ReleaseBinaryBuilder {
    private readonly expectedArtifacts = [
        "dist/flyflor",
        "dist/flyflor-linux-x64",
        "dist/flyflor-linux-arm64",
    ];

    private readonly commands: string[][] = [
        ["bun", "install", "--frozen-lockfile", "--os=linux", "--cpu=*"],
        ["bun", "run", "build:binary"],
        ["bun", "run", "build:binary:linux-x64"],
        ["bun", "run", "build:binary:linux-arm64"],
    ];

    public async run(): Promise<void> {
        for (const command of this.commands) {
            console.log(`\n$ ${command.join(" ")}`);
            const subprocess = Bun.spawn(command, {
                stdout: "inherit",
                stderr: "inherit",
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
                console.error(`Missing release binary artifact: ${path}`);
                process.exit(1);
            }
        }
    }
}

await new ReleaseBinaryBuilder().run();
