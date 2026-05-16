/**
 * Central test runner.
 *
 * package.json stays readable by delegating test suites here. The default
 * suite is deterministic and offline; live model probes are opt-in because
 * they use the user's real ~/.flyflor/config.jsonc provider credentials.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

type SuiteName = "all" | "docs" | "live" | "live:docker";

const suites: Record<SuiteName, true> = { all: true, docs: true, live: true, "live:docker": true };
const suite = readSuiteName(process.argv[2]);
const subprocess = Bun.spawn(await buildCommand(suite), {
    env: buildEnvironment(suite),
    stdout: "inherit",
    stderr: "inherit",
});

process.exit(await subprocess.exited);

function readSuiteName(value: string | undefined): SuiteName {
    if (!value) {
        return "all";
    }
    if (value === "all" || value === "docs" || value === "live" || value === "live:docker") {
        return value;
    }
    console.error(`Unknown test suite: ${value}`);
    console.error(`Available suites: ${Object.keys(suites).join(", ")}`);
    process.exit(1);
}

async function buildCommand(suite: SuiteName): Promise<string[]> {
    if (suite === "docs") {
        return [
            "bun",
            "test",
            "tests/docs.index.test.ts",
            "tests/docs.references.test.ts",
            "tests/todo.status.test.ts",
        ];
    }
    if (suite === "live" || suite === "live:docker") {
        return ["bun", "test", "tests/live.model.test.ts"];
    }
    const testsDir = join(import.meta.dir, "..", "tests");
    const files = (await readdir(testsDir))
        .filter((file) => file.endsWith(".test.ts") && file !== "live.model.test.ts")
        .sort()
        .map((file) => `tests/${file}`);
    return ["bun", "test", ...files];
}

function buildEnvironment(suite: SuiteName): Record<string, string | undefined> {
    // This is a test-runner switch only. Runtime/business config still comes
    // from JSONC via loadConfig()/loadConfigForPaths(), never from env vars.
    return {
        ...Bun.env,
        FLYFLOR_LIVE_TEST_CONFIG: suite === "live:docker" ? "docker" : undefined,
    };
}
