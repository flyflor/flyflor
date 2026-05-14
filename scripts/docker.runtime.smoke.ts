import { join } from "node:path";

interface SmokeStep {
    command: string[];
    expect?: RegExp;
    check?: (output: string) => boolean;
    name: string;
    retries?: number;
    retryDelayMs?: number;
}

export interface DockerRuntimeSmokeOptions {
    devContainerName?: string;
    dockerNetwork?: string;
    repoRoot?: string;
}

export function buildDockerRuntimeSmokePlan(options: DockerRuntimeSmokeOptions = {}): SmokeStep[] {
    const root = options.repoRoot ?? join(import.meta.dir, "..");
    const devContainer = options.devContainerName ?? "flyflor-dev";
    const network = options.dockerNetwork ?? "flyflor_flyflor-internal";
    const bunImage = "oven/bun:1.3.10-alpine";
    const redisSmoke = `FLYFLOR_REDIS_URL=redis://redis:6379 bun run scripts/redis.smoke.ts`;
    const surrealSmoke = `FLYFLOR_SURREAL_URL=http://surrealdb:8000 bun run scripts/surreal.smoke.ts`;

    return [
        {
            name: "dev doctor",
            command: ["docker", "exec", devContainer, "flyflor", "doctor"],
            expect: /Background scheduler[^\n]*ok/iu,
            retries: 20,
            retryDelayMs: 500,
        },
        {
            name: "redis smoke",
            command: [
                "docker",
                "run",
                "--rm",
                "--network",
                network,
                "-v",
                `${root}:/w`,
                "-w",
                "/w",
                bunImage,
                "sh",
                "-lc",
                redisSmoke,
            ],
            expect: /"ringSize":\s*\d+/iu,
        },
        {
            name: "surreal smoke",
            command: [
                "docker",
                "run",
                "--rm",
                "--network",
                network,
                "-v",
                `${root}:/w`,
                "-w",
                "/w",
                bunImage,
                "sh",
                "-lc",
                surrealSmoke,
            ],
            expect: /"counts":/iu,
        },
        {
            name: "chat main path",
            command: [
                "docker",
                "exec",
                devContainer,
                "flyflor",
                "chat",
                "--query",
                "runtime smoke",
                "--quiet",
            ],
            check: (output) => output.trim().length > 0 && !/error:/iu.test(output),
        },
    ];
}

export async function runDockerRuntimeSmoke(options: DockerRuntimeSmokeOptions = {}): Promise<void> {
    const plan = buildDockerRuntimeSmokePlan(options);
    for (const step of plan) {
        await runStepWithRetry(step);
        console.log(`ok ${step.name}`);
    }
}

if (import.meta.main) {
    const dockerNetwork = readArg("--network");
    const devContainerName = readArg("--container");
    await runDockerRuntimeSmoke({
        devContainerName: devContainerName ?? undefined,
        dockerNetwork: dockerNetwork ?? undefined,
    });
}

async function runStep(step: SmokeStep): Promise<{ exitCode: number; output: string }> {
    const proc = Bun.spawn(step.command, {
        stderr: "pipe",
        stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { exitCode, output: `${stdout}${stderr}` };
}

async function runStepWithRetry(step: SmokeStep): Promise<void> {
    const retries = step.retries ?? 0;
    const retryDelayMs = step.retryDelayMs ?? 250;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const result = await runStep(step);
        const error = validateStepResult(step, result);
        if (!error) {
            return;
        }
        lastError = error;
        if (attempt < retries) {
            await sleep(retryDelayMs);
        }
    }

    throw lastError ?? new Error(`[${step.name}] failed`);
}

function validateStepResult(step: SmokeStep, result: { exitCode: number; output: string }): Error | undefined {
    if (result.exitCode !== 0) {
        return new Error(`[${step.name}] exited ${result.exitCode}\n${result.output}`);
    }
    if (step.expect && !step.expect.test(result.output)) {
        return new Error(`[${step.name}] output did not match ${step.expect}\n${result.output}`);
    }
    if (step.check && !step.check(result.output)) {
        return new Error(`[${step.name}] output failed validation\n${result.output}`);
    }
    return undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readArg(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    if (index < 0) return undefined;
    return process.argv[index + 1];
}
