#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RecoverySmokeReport {
    backupWarmup: WorkingMemoryWarmupEvent;
    firstWarmup: WorkingMemoryWarmupEvent;
    ok: boolean;
    recoveryWarmup: WorkingMemoryWarmupEvent;
    tempHome: string;
    usedBinary: string;
}

interface WorkingMemoryWarmupEvent {
    backend?: string;
    loaded?: boolean;
    loadedFrom?: string;
    recoveredFromBackup?: boolean;
    replayedWalRecords?: number;
    tornWalLines?: number;
    latencyMs?: number;
    workingMemoryHealth?: Record<string, unknown>;
}

async function main(): Promise<void> {
    const repoRoot = join(import.meta.dir, "..");
    const tempHome = await mkdtemp(join(tmpdir(), "flyflor-working-memory-recovery-"));
    const tempConfigHome = join(tempHome, ".config");
    const tempDataHome = join(tempHome, ".local", "share");
    const tempCacheHome = join(tempHome, ".cache");
    const tempMemoryDir = join(tempConfigHome, "memory");
    const tempLogDir = join(tempHome, "logs");
    const socketCommand = resolveSocketCommand(repoRoot);
    const gatewayPort = await findFreeTcpPort();

    try {
        await mkdir(tempConfigHome, { recursive: true });
        await mkdir(tempMemoryDir, { recursive: true });
        await mkdir(tempLogDir, { recursive: true });
        await writeFile(join(tempConfigHome, "config.jsonc"), renderConfigJsonc(gatewayPort), "utf8");
        await runInstallTemplates(tempConfigHome, repoRoot);

        const firstStart = await startSocket(tempHome, tempDataHome, tempCacheHome, repoRoot, socketCommand);
        const firstOutput = await settleAndCollect(firstStart, 1200);
        const firstWarmup = extractWarmup(firstOutput);
        assertWarmup(firstWarmup, "first warmup");

        await writeRecoveryWal(tempMemoryDir);

        const secondStart = await startSocket(tempHome, tempDataHome, tempCacheHome, repoRoot, socketCommand);
        const secondOutput = await settleAndCollect(secondStart, 1200);
        const recoveryWarmup = extractWarmup(secondOutput);
        assertWarmup(recoveryWarmup, "recovery warmup");

        await writeRecoveryBackupSnapshot(tempMemoryDir);

        const thirdStart = await startSocket(tempHome, tempDataHome, tempCacheHome, repoRoot, socketCommand);
        const thirdOutput = await settleAndCollect(thirdStart, 1200);
        const backupWarmup = extractWarmup(thirdOutput);
        assertWarmup(backupWarmup, "backup recovery warmup");

        const report: RecoverySmokeReport = {
            backupWarmup,
            firstWarmup,
            ok:
                firstWarmup.loadedFrom === "empty" &&
                recoveryWarmup.loadedFrom === "wal" &&
                recoveryWarmup.replayedWalRecords === 1 &&
                recoveryWarmup.tornWalLines === 1 &&
                backupWarmup.loadedFrom === "backup" &&
                backupWarmup.recoveredFromBackup === true,
            recoveryWarmup,
            tempHome,
            usedBinary: socketCommand.join(" "),
        };

        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) {
            process.exitCode = 1;
        }
    } finally {
        await rm(tempHome, { recursive: true, force: true });
    }
}

function resolveSocketCommand(repoRoot: string): string[] {
    if (process.platform === "linux") {
        // Release smoke should exercise the release asset name first; Docker dev
        // keeps its historical mount artifact as a fallback for local workflows.
        for (const name of ["flyflor-linux-x64", "flyflor-linux"]) {
            const binaryPath = join(repoRoot, "dist", name);
            if (existsSync(binaryPath)) return [binaryPath, "socket"];
        }
    }
    return [process.execPath, "run", "--conditions=browser", "app.ts", "socket"];
}

async function runInstallTemplates(targetHome: string, repoRoot: string): Promise<void> {
    const proc = Bun.spawn(
        [
            process.execPath,
            "run",
            "scripts/install.templates.ts",
            "--target",
            targetHome,
            "--force",
        ],
        {
            cwd: repoRoot,
            env: withEnv({ HOME: targetHome }),
            stderr: "pipe",
            stdout: "pipe",
        },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0) {
        throw new Error(`template install failed (${exitCode})\n${stdout}${stderr}`);
    }
}

async function startSocket(
    home: string,
    dataHome: string,
    cacheHome: string,
    cwd: string,
    command: string[],
): Promise<Bun.Subprocess> {
    const proc = Bun.spawn(command, {
        cwd,
        env: withEnv({
            FLYFLOR_HOME: home,
            HOME: home,
            XDG_CACHE_HOME: cacheHome,
            XDG_DATA_HOME: dataHome,
        }),
        stderr: "pipe",
        stdout: "pipe",
    });
    return proc;
}

async function settleAndCollect(proc: Bun.Subprocess, waitMs: number): Promise<string> {
    await sleep(waitMs);
    proc.kill();
    await proc.exited.catch(() => undefined);
    const [stdout, stderr] = await Promise.all([readPipe(proc.stdout), readPipe(proc.stderr)]);
    return `${stdout}\n${stderr}`;
}

async function writeRecoveryWal(memoryDir: string): Promise<void> {
    const goodRecord = {
        episode: {
            expiresAt: 9999999999999,
            record: {
                concepts: ["recovery"],
                createdAt: 1700000000000,
                embedding: [0.1, 0.2],
                episodeId: "smoke-recovery-episode",
                importance: 0.9,
                metadata: {},
                ownerKey: "scope:smoke",
                sourceKind: "smoke",
                stability: 0.8,
                text: "recovery smoke",
            },
            reviewAt: 9999999999,
        },
        op: "write-episode",
    };
    const wal = `${JSON.stringify(goodRecord)}\n{"op":"write-episode"`;
    await writeFile(join(memoryDir, "working.wal.jsonl"), wal, "utf8");
}

async function writeRecoveryBackupSnapshot(memoryDir: string): Promise<void> {
    const backupPayload = {
        activation: [],
        context: [["smoke-user", ["smoke-backup-episode"]]],
        episodes: [
            {
                expiresAt: 9999999999999,
                record: {
                    concepts: ["backup-recovery"],
                    createdAt: 1700000000000,
                    embedding: [0.3, 0.4],
                    episodeId: "smoke-backup-episode",
                    importance: 0.8,
                    metadata: {},
                    ownerKey: "scope:smoke",
                    sourceKind: "smoke",
                    stability: 0.9,
                    text: "backup recovery smoke",
                },
                reviewAt: 9999999999,
            },
        ],
        schemaVersion: 1,
    };
    await writeFile(join(memoryDir, "working.snapshot.json"), "{broken", "utf8");
    await writeFile(join(memoryDir, "working.snapshot.json.bak"), `${JSON.stringify(backupPayload)}\n`, "utf8");
    await writeFile(join(memoryDir, "working.wal.jsonl"), "", "utf8");
}

function extractWarmup(output: string): WorkingMemoryWarmupEvent {
    const lines = stripAnsi(output)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]!;
        if (!line.includes("\"memory.warmup.complete\"")) {
            continue;
        }
        const parsed = JSON.parse(line) as { payload?: WorkingMemoryWarmupEvent };
        if (!parsed.payload) {
            continue;
        }
        return {
            ...parsed.payload,
            ...(parsed.payload.workingMemoryHealth ?? {}),
        } as WorkingMemoryWarmupEvent;
    }
    throw new Error(`memory.warmup.complete not found in output\n${output}`);
}

function assertWarmup(event: WorkingMemoryWarmupEvent, label: string): void {
    if (event.backend !== "local") {
        throw new Error(`${label} backend mismatch: ${event.backend}`);
    }
    if (!event.workingMemoryHealth || typeof event.workingMemoryHealth !== "object") {
        throw new Error(`${label} missing workingMemoryHealth`);
    }
}

async function findFreeTcpPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
    if (!address || typeof address === "string") {
        throw new Error("failed to allocate a recovery smoke TCP port");
    }
    return address.port;
}

function renderConfigJsonc(gatewayPort: number): string {
    return JSON.stringify(
        {
            gateway: {
                allowedChannels: ["api"],
                channelReplyUrls: {},
                channels: {
                    api: {},
                },
                host: "127.0.0.1",
                port: gatewayPort,
                stdio: false,
            },
            memory: {
                crystal: {
                    enabled: false,
                },
                working: {
                    backend: "local",
                },
            },
            model: {
                activeModel: "llama3.2",
                activeProvider: "local",
                providers: {
                    local: {
                        apiKey: "ollama",
                        baseUrl: "http://127.0.0.1:11434/v1",
                        defaultModel: "llama3.2",
                        models: ["llama3.2"],
                        type: "openai-compatible",
                    },
                },
            },
            sandbox: {
                mode: "off",
            },
        },
        null,
        2,
    );
}

function stripAnsi(value: string): string {
    return value.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "");
}

async function readPipe(pipe: Bun.Subprocess["stdout"] | Bun.Subprocess["stderr"]): Promise<string> {
    if (!pipe || typeof pipe === "number") {
        return "";
    }
    return await new Response(pipe as ReadableStream<Uint8Array>).text();
}

function withEnv(extra: Record<string, string>): Record<string, string> {
    return {
        ...process.env,
        ...extra,
    } as Record<string, string>;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
