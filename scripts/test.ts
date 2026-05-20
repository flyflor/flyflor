/**
 * Central test runner.
 *
 * package.json stays readable by delegating test suites here. The default
 * suite is deterministic and offline; live model probes stay isolated in
 * dedicated suites because they use the user's real
 * ~/.flyflor/.config/config.jsonc provider credentials.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

type SuiteName = "all" | "docs" | "live" | "live:docker" | "kernel";

const LIVE_TEST_FILES = new Set(["live.agent.test.ts", "live.model.test.ts"]);

const suites: Record<SuiteName, true> = { all: true, docs: true, live: true, "live:docker": true, kernel: true };
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
    if (value === "all" || value === "docs" || value === "live" || value === "live:docker" || value === "kernel") {
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
    if (suite === "kernel") {
        return [
            "bun",
            "test",
            "tests/agent.functional.smoke.test.ts",
            "tests/blackboard.boundaries.test.ts",
            "tests/chaos.fuzz.test.ts",
            "tests/docs.index.test.ts",
            "tests/docs.references.test.ts",
            "tests/event.component.test.ts",
            "tests/executive.tool.runtime.test.ts",
            "tests/gateway.module.test.ts",
            "tests/gateway.ws.test.ts",
            "tests/memory.scheduler.wiring.test.ts",
            "tests/protocol.control.test.ts",
            "tests/reflection.boundaries.test.ts",
            "tests/reflection.worker.test.ts",
            "tests/runtime.executive.boundaries.test.ts",
            "tests/runtime.mcp.tool.plan.test.ts",
            "tests/runtime.perf.test.ts",
            "tests/todo.status.test.ts",
        ];
    }
    if (suite === "live" || suite === "live:docker") {
        // Live suites intentionally exercise the user's configured provider.
        // Deterministic gates stay offline, while kernel-seal/release bars can
        // call this suite explicitly when real-model validation is required.
        return ["bun", "test", "tests/live.model.test.ts", "tests/live.agent.test.ts"];
    }
    const testsDir = join(import.meta.dir, "..", "tests");
    const files = (await readdir(testsDir))
        .filter((file) => file.endsWith(".test.ts") && !LIVE_TEST_FILES.has(file))
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
