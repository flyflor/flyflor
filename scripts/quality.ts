/**
 * Quality gate runner used by package scripts.
 *
 * The steps stay in TypeScript instead of a long package.json chain so the
 * command surface is short, ordered, and easy to extend without shell syntax
 * drift. This deterministic gate intentionally excludes live model probes.
 */

type GateName = "ci" | "release";

const gates: Record<GateName, string[][]> = {
    ci: [
        ["bun", "run", "docs:check"],
        ["bun", "run", "check"],
        ["bun", "run", "test"],
        ["bun", "run", "build:binary"],
        ["bun", "run", "smoke:gateway:service"],
        ["bun", "run", "build:binary:docker"],
        ["bun", "run", "smoke:docker:binary"],
        ["bun", "run", "smoke:recovery"],
    ],
    release: [
        ["bun", "run", "docs:check"],
        ["bun", "run", "check"],
        ["bun", "run", "test"],
        ["bun", "run", "build:release"],
        ["bun", "run", "smoke:gateway:service"],
        ["bun", "run", "smoke:recovery"],
        ["bun", "run", "docker:up"],
        ["bun", "run", "smoke:runtime"],
    ],
};

const gate = readGateName(process.argv[2]);
for (const command of gates[gate]) {
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

function readGateName(value: string | undefined): GateName {
    if (value === "ci" || value === "release") {
        return value;
    }
    console.error(`Unknown quality gate: ${value ?? "(missing)"}`);
    console.error(`Available gates: ${Object.keys(gates).join(", ")}`);
    process.exit(1);
}
