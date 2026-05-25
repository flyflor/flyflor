#!/usr/bin/env bun
import { access, chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { delimiter } from "node:path";
import { dirname, isAbsolute, join, resolve } from "node:path";

type InstallMode = "real" | "mock";

const PACKAGE_IDS = [
    "browser-cdp",
    "search-web",
    "media",
    "computer-native",
    "computer-use",
    "utility",
    "mock",
] as const;

interface InitOptions {
    readonly cdpUrl: string;
    readonly mode: InstallMode;
    readonly runner: string;
    readonly runnerName: string;
    readonly sourceRoot: string;
    readonly targetDir: string;
}

class XToolsInitializer {
    public async run(options: InitOptions): Promise<void> {
        await mkdir(join(options.targetDir, "packages"), { recursive: true });
        await this.writePackages(options);

        await writeFile(
            join(options.targetDir, "external.tools.jsonc"),
            this.manifest(options),
            "utf8",
        );

        console.log(`flyflor xtools initialized`);
        console.log(`mode: ${options.mode}`);
        console.log(`runner: ${options.runner}`);
        console.log(`config: ${join(options.targetDir, "external.tools.jsonc")}`);
    }

    private async writePackages(options: InitOptions): Promise<void> {
        for (const id of PACKAGE_IDS) {
            const dir = join(options.targetDir, "packages", id);
            const binDir = join(dir, "bin");
            await mkdir(binDir, { recursive: true });
            const command = this.packageCommand(options.targetDir, id, options.runnerName);
            const binary = join(binDir, options.runnerName);
            await copyFile(options.runner, binary);
            await chmod(binary, 0o755).catch(() => undefined);
            await writeFile(
                join(dir, "README.md"),
                [
                    `# ${id}`,
                    "",
                    "This directory is the project-local payload for the external tool package.",
                    "",
                    `Runtime discovery stays in ../../external.tools.jsonc. The command registered there points to ${command}.`,
                    "",
                ].join("\n"),
                "utf8",
            );
            await writeFile(
                join(dir, "package.jsonc"),
                `${JSON.stringify({
                    schemaVersion: 1,
                    id,
                    kind: "external-tool-package",
                    registry: "../../external.tools.jsonc",
                    runtime: "process-json",
                    command,
                }, null, 4)}\n`,
                "utf8",
            );
        }
    }

    private packageCommand(targetDir: string, id: string, runnerName: string): string {
        return `./${targetDir.replace(/^\.\//, "").replace(/\\/g, "/")}/packages/${id}/bin/${runnerName}`;
    }

    private manifest(options: InitOptions): string {
        if (options.mode === "mock") {
            return `${JSON.stringify(this.mockManifest(options), null, 4)}\n`;
        }
        return `${JSON.stringify(this.realManifest(options), null, 4)}\n`;
    }

    private realManifest(options: InitOptions): Record<string, unknown> {
        return {
            schemaVersion: 1,
            sidecars: {
                "browser.cdp": {
                    command: this.packageCommand(options.targetDir, "browser-cdp", options.runnerName),
                    args: ["xtool-sidecar", "browser.cdp"],
                    cwd: "app",
                    env: {
                        FLYFLOR_BROWSER_CDP_URL: options.cdpUrl,
                    },
                    timeoutMs: 8000,
                    maxOutputBytes: 65536,
                    tools: [
                        "browser.open",
                        "browser.snapshot",
                        "browser.screenshot",
                        "browser.click",
                        "browser.type",
                        "browser.navigate",
                        "browser.evaluate",
                    ],
                },
                "computer.native": {
                    command: this.packageCommand(options.targetDir, "computer-native", options.runnerName),
                    args: ["xtool-sidecar", "computer.native"],
                    cwd: "app",
                    config: {
                        mouseCommand: "",
                        mouseArgs: [],
                        keyboardCommand: "",
                        keyboardArgs: [],
                    },
                    timeoutMs: 10000,
                    maxOutputBytes: 65536,
                    tools: [
                        "screen.screenshot",
                        "computer.mouse",
                        "computer.keyboard",
                        "computer.window",
                    ],
                },
                "computer.use": {
                    command: this.packageCommand(options.targetDir, "computer-use", options.runnerName),
                    args: ["xtool-sidecar", "computer.use"],
                    cwd: "app",
                    config: {
                        backend: "delegate",
                        delegateCommand: "",
                        delegateArgs: [],
                        cuaCommand: "cua-driver",
                        cuaArgs: [],
                    },
                    timeoutMs: 20000,
                    maxOutputBytes: 524288,
                    tools: ["computer.use"],
                },
                "media.local": {
                    command: this.packageCommand(options.targetDir, "media", options.runnerName),
                    args: ["xtool-sidecar", "media.local"],
                    cwd: "app",
                    config: {
                        providerUrl: "",
                        providerHeaders: {},
                        localCommands: {},
                    },
                    timeoutMs: 30000,
                    maxOutputBytes: 262144,
                    tools: [
                        "vision.analyze",
                        "vision.ocr",
                        "audio.transcribe",
                        "audio.speak",
                    ],
                },
                "web.search": {
                    command: this.packageCommand(options.targetDir, "search-web", options.runnerName),
                    args: ["xtool-sidecar", "web.search"],
                    cwd: "app",
                    config: {
                        cacheTtlMs: 600000,
                        providers: [],
                    },
                    timeoutMs: 10000,
                    maxOutputBytes: 65536,
                    tools: [
                        "web.search",
                        "web.fetch",
                        "web.extract",
                        "web.download",
                    ],
                },
                "utility.local": {
                    command: this.packageCommand(options.targetDir, "utility", options.runnerName),
                    args: ["xtool-sidecar", "utility.local"],
                    cwd: "app",
                    config: {
                        lspCommand: "",
                        lspArgs: [],
                        taskCommand: "",
                        taskArgs: [],
                    },
                    timeoutMs: 30000,
                    maxOutputBytes: 262144,
                    tools: [
                        "lsp.symbols",
                        "lsp.diagnostics",
                        "task.background",
                        "file.hash",
                        "archive.create",
                        "archive.extract",
                        "data.convert",
                    ],
                },
            },
        };
    }

    private mockManifest(options: InitOptions): Record<string, unknown> {
        return {
            schemaVersion: 1,
            sidecars: {
                "mock.xtools": {
                    mock: true,
                    command: this.packageCommand(options.targetDir, "mock", options.runnerName),
                    args: ["xtool-sidecar", "mock.xtools"],
                    cwd: "app",
                    timeoutMs: 2000,
                    maxOutputBytes: 65536,
                    tools: [
                        "browser.open",
                        "browser.snapshot",
                        "browser.screenshot",
                        "browser.click",
                        "browser.type",
                        "browser.navigate",
                        "browser.evaluate",
                        "screen.screenshot",
                        "computer.use",
                        "computer.mouse",
                        "computer.keyboard",
                        "computer.window",
                        "vision.analyze",
                        "vision.ocr",
                        "audio.transcribe",
                        "audio.speak",
                        "web.search",
                        "web.fetch",
                        "web.extract",
                        "web.download",
                        "lsp.symbols",
                        "lsp.diagnostics",
                        "file.hash",
                        "archive.create",
                        "archive.extract",
                        "data.convert",
                        "task.background",
                    ],
                },
            },
        };
    }
}

class InitCli {
    public async parse(argv: readonly string[]): Promise<InitOptions> {
        const sourceRoot = resolve(dirname(Bun.main), "..");
        let mode: InstallMode = "real";
        let targetDir = join(".", "tools");
        let cdpUrl = "http://127.0.0.1:9222";
        let runner: string | undefined;

        for (let index = 0; index < argv.length; index += 1) {
            const arg = argv[index];
            if (arg === "--mock") {
                mode = "mock";
                continue;
            }
            if (arg === "--real") {
                mode = "real";
                continue;
            }
            if (arg === "--home") {
                const value = argv[index + 1];
                if (!value) {
                    throw new Error("--home requires a path");
                }
                targetDir = join(value, "tools");
                index += 1;
                continue;
            }
            if (arg === "--target") {
                const value = argv[index + 1];
                if (!value) {
                    throw new Error("--target requires a path");
                }
                targetDir = value;
                index += 1;
                continue;
            }
            if (arg === "--cdp-url") {
                const value = argv[index + 1];
                if (!value) {
                    throw new Error("--cdp-url requires a URL");
                }
                cdpUrl = value;
                index += 1;
                continue;
            }
            if (arg === "--runner") {
                const value = argv[index + 1];
                if (!value) {
                    throw new Error("--runner requires a path or command");
                }
                runner = value;
                index += 1;
                continue;
            }
            if (arg === "--help" || arg === "-h") {
                this.printHelp();
                process.exit(0);
            }
            throw new Error(`Unknown argument: ${arg}`);
        }

        return {
            cdpUrl,
            mode,
            runner: await this.resolveRunner(sourceRoot, runner),
            runnerName: platformBinaryName(),
            sourceRoot,
            targetDir,
        };
    }

    public printHelp(): void {
        console.log("Usage: bun tools/init.ts [--real|--mock] [--target PATH] [--runner PATH] [--cdp-url URL]");
        console.log("");
        console.log("Options:");
        console.log("  --real         Install real process-json sidecars. This is the default.");
        console.log("  --mock         Install one mock sidecar for protocol and catalog testing.");
        console.log("  --target PATH  Override ./tools.");
        console.log("  --home PATH    Compatibility alias for PATH/tools.");
        console.log("  --runner PATH  Flyflor binary used as the bundled sidecar runner.");
        console.log("  --cdp-url URL  Browser DevTools endpoint for browser.* tools.");
    }

    private async resolveRunner(sourceRoot: string, explicit?: string): Promise<string> {
        if (explicit) {
            return explicit;
        }
        const localRunner = `./dist/${platformBinaryName()}`;
        const candidates = [localRunner, join(sourceRoot, "dist", platformBinaryName()), "flyflor"];
        for (const candidate of candidates) {
            if (await commandExists(candidate)) {
                return candidate === localRunner ? localRunner : candidate;
            }
        }
        throw new Error("Flyflor binary was not found. Run bun run build:binary or pass --runner PATH.");
    }
}

const cli = new InitCli();
const initializer = new XToolsInitializer();
await initializer.run(await cli.parse(Bun.argv.slice(2)));

function platformBinaryName(): string {
    return process.platform === "win32" ? "flyflor.exe" : "flyflor";
}

async function commandExists(command: string): Promise<boolean> {
    if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
        return pathExists(command);
    }
    for (const dir of pathEntries()) {
        if (await pathExists(join(dir, command))) {
            return true;
        }
        if (process.platform === "win32" && await pathExists(join(dir, `${command}.exe`))) {
            return true;
        }
    }
    return false;
}

function pathEntries(): string[] {
    return (process.env.PATH ?? "").split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}
