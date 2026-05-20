/**
 * Quality gate runner used by package scripts.
 *
 * The steps stay in TypeScript instead of a long package.json chain so the
 * command surface is short, ordered, and easy to extend without shell syntax
 * drift. `kernel-seal` is the inner-kernel release bar and includes the live
 * model probes the team now uses as a hard gate.
 */

type GateName = "ci" | "kernel-seal" | "release";

const gates: Record<GateName, string[][]> = {
    ci: [
        ["bun", "run", "docs:check"],
        ["bun", "run", "check"],
        ["bun", "run", "test"],
        ["bun", "run", "smoke:agent"],
        ["bun", "run", "build:binary"],
        ["bun", "run", "smoke:gateway:service"],
        ["bun", "run", "build:binary:docker"],
        ["bun", "run", "smoke:docker:binary"],
        ["bun", "run", "smoke:recovery"],
    ],
    "kernel-seal": [
        ["bun", "run", "docs:check"],
        ["bun", "run", "check"],
        ["bun", "run", "test"],
        ["bun", "run", "smoke:agent"],
        ["bun", "run", "smoke:recovery"],
        ["bun", "run", "build:binary"],
        ["bun", "run", "build:binary:docker"],
        ["bun", "run", "smoke:gateway:service"],
        ["bun", "run", "smoke:docker:binary"],
        ["bun", "run", "test:live"],
        ["bun", "run", "smoke:agent:live"],
    ],
    release: [
        ["bun", "run", "docs:check"],
        ["bun", "run", "check"],
        ["bun", "run", "test"],
        ["bun", "run", "smoke:agent"],
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
        env: {
            ...Bun.env,
            FLYFLOR_LIVE_REQUIRED:
                gate === "kernel-seal" &&
                (command[2] === "test:live" || command[2] === "smoke:agent:live")
                    ? "1"
                    : undefined,
        },
        stdout: "inherit",
        stderr: "inherit",
    });
    const code = await subprocess.exited;
    if (code !== 0) {
        process.exit(code);
    }
}

function readGateName(value: string | undefined): GateName {
    if (value === "ci" || value === "kernel-seal" || value === "release") {
        return value;
    }
    console.error(`Unknown quality gate: ${value ?? "(missing)"}`);
    console.error(`Available gates: ${Object.keys(gates).join(", ")}`);
    process.exit(1);
}
