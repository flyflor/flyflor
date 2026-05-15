interface SmokeStep {
    command: string[];
    expect?: RegExp;
    check?: (output: string) => boolean;
    name: string;
    note?: (output: string) => string | undefined;
    retries?: number;
    retryDelayMs?: number;
}

export interface DockerRuntimeSmokeOptions {
    chatProbe?: boolean;
    devContainerName?: string;
    dockerNetwork?: string;
    requireProviderKey?: boolean;
    repoRoot?: string;
}

export function buildDockerRuntimeSmokePlan(options: DockerRuntimeSmokeOptions = {}): SmokeStep[] {
    const devContainer = options.devContainerName ?? "flyflor-dev";
    const requireProviderKey = Boolean(options.requireProviderKey || options.chatProbe);
    void options.repoRoot;
    void options.dockerNetwork;

    const plan: SmokeStep[] = [
        {
            name: "dev doctor",
            command: ["docker", "exec", devContainer, "flyflor", "doctor"],
            expect: /Brain\.db|Memory|Flyflor/iu,
            check: (output) => validateProviderKeyReadiness(output, requireProviderKey),
            note: (output) => providerReadinessNote(output, requireProviderKey),
            retries: 20,
            retryDelayMs: 500,
        },
        {
            name: "status main path",
            command: ["docker", "exec", devContainer, "flyflor", "status"],
            expect: /Model|Memory|Gateway/iu,
        },
    ];
    if (options.chatProbe) {
        plan.push({
            name: "provider chat probe",
            command: ["docker", "exec", devContainer, "flyflor", "-z", "Reply with exactly: FLYFLOR_SMOKE_OK"],
            expect: /FLYFLOR_SMOKE_OK/u,
        });
    }
    return plan;
}

export async function runDockerRuntimeSmoke(options: DockerRuntimeSmokeOptions = {}): Promise<void> {
    const plan = buildDockerRuntimeSmokePlan(options);
    for (const step of plan) {
        const output = await runStepWithRetry(step);
        console.log(`ok ${step.name}`);
        const note = step.note?.(output);
        if (note) {
            console.log(`note ${step.name}: ${note}`);
        }
    }
}

if (import.meta.main) {
    const chatProbe = process.argv.includes("--chat-probe");
    const dockerNetwork = readArg("--network");
    const devContainerName = readArg("--container");
    const requireProviderKey = process.argv.includes("--require-provider-key");
    try {
        await runDockerRuntimeSmoke({
            chatProbe,
            devContainerName: devContainerName ?? undefined,
            dockerNetwork: dockerNetwork ?? undefined,
            requireProviderKey,
        });
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
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

async function runStepWithRetry(step: SmokeStep): Promise<string> {
    const retries = step.retries ?? 0;
    const retryDelayMs = step.retryDelayMs ?? 250;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const result = await runStep(step);
        const error = validateStepResult(step, result);
        if (!error) {
            return result.output;
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
        const note = step.note?.(result.output);
        return new Error(`[${step.name}] output failed validation${note ? `: ${note}` : ""}\n${result.output}`);
    }
    return undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readDoctorApiKeyState(output: string): { status: string; detail: string } | undefined {
    // Smoke scripts parse the doctor table as a CLI contract, keeping provider readiness outside runtime semantics.
    const line = output
        .split(/\r?\n/u)
        .find((entry) => /\bAPI key\b/iu.test(entry) && /[│|]/u.test(entry));
    if (!line) return undefined;
    const columns = line
        .split(/[│|]/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const labelIndex = columns.findIndex((part) => /^API key$/iu.test(part));
    const status = columns[labelIndex + 1];
    const detail = columns[labelIndex + 2];
    if (!status || !detail) return undefined;
    return { status: status.toLowerCase(), detail: detail.toLowerCase() };
}

function validateProviderKeyReadiness(output: string, requireProviderKey: boolean): boolean {
    if (!requireProviderKey) return true;
    const state = readDoctorApiKeyState(output);
    return state?.status === "ok" && state.detail === "configured";
}

function providerReadinessNote(output: string, requireProviderKey: boolean): string | undefined {
    const state = readDoctorApiKeyState(output);
    if (!state) {
        return requireProviderKey ? "provider credential state was not visible in doctor output" : undefined;
    }
    if (state.status === "ok" && state.detail === "configured") {
        return undefined;
    }
    if (requireProviderKey) {
        return `provider credential is ${state.detail}; live provider smoke cannot run`;
    }
    return `provider credential is ${state.detail}; deterministic runtime checks passed, live chat probe skipped`;
}

function readArg(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    if (index < 0) return undefined;
    return process.argv[index + 1];
}
