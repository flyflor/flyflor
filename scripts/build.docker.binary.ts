const targets: Record<string, string> = {
    arm64: "bun-linux-arm64",
    x64: "bun-linux-x64",
};

const target = targets[process.arch];

if (!target) {
    console.error(`Unsupported Docker dev architecture: ${process.arch}`);
    process.exit(1);
}

const subprocess = Bun.spawn(
    [
        "bun",
        "build",
        "--compile",
        `--target=${target}`,
        "--packages=bundle",
        "--conditions=browser",
        "--reject-unresolved",
        "--outfile",
        "dist/flyflor-linux",
        "app.ts",
    ],
    {
        stdout: "inherit",
        stderr: "inherit",
    },
);

process.exit(await subprocess.exited);
