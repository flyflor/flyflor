/**
 * Release binary builder.
 *
 * Bun skips foreign optional native packages during normal local install. The
 * release build needs OpenTUI's Linux x64 and arm64 native packages present so
 * `bun build --compile --target=bun-linux-*` can resolve the target import.
 */
class ReleaseBinaryBuilder {
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
    }
}

await new ReleaseBinaryBuilder().run();
