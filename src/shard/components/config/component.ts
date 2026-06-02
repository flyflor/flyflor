import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Component, FComponent, Init } from "@/core";

/**
 * Runtime routes allowed at the public runtime boundary.
 * `Fast` is for immediate answers; `Thinking` is for analysis, tools, planning, and validation loops.
 */
export enum RuntimeRoute {
    Fast = "fast",
    Thinking = "thinking",
}

/**
 * One LLM provider profile.
 * `defaultModel` is used when a scenario does not override it; `models` lists the provider's supported names.
 */
export interface LlmProviderConfig {
    defaultModel: string;
    models: string[];
}

/**
 * LLM configuration available to runtime modules.
 * `defaultProvider` selects a key from `providers`.
 */
export interface LlmConfig {
    defaultProvider: string;
    providers: Record<string, LlmProviderConfig>;
}

/**
 * Sandbox defaults applied before real guard policies subscribe to the capillary layer.
 * `defaultDecision` must map onto the capillary decision protocol.
 */
export interface SandboxConfig {
    defaultDecision: "allow" | "deny";
}

/**
 * Storage configuration.
 * `schemaDirectory` is the repo-relative directory holding SQL schema-init scripts.
 */
export interface StorageConfig {
    schemaDirectory: string;
}

/**
 * Skills configuration.
 * `directory` is the repo-relative directory holding skill sub-folders (each with a `SKILL.md`).
 */
export interface SkillsConfig {
    directory: string;
}

/**
 * One MCP (Model Context Protocol) server definition.
 * stdio transport: `command` + `args` + `env`. http/sse transport: `url`.
 */
export interface MCPServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
}

/**
 * MCP configuration: a map of server name → server definition.
 */
export interface MCPConfig {
    servers: Record<string, MCPServerConfig>;
}

/**
 * The single JSONC configuration object Flyflor consumes.
 * All business configuration flows through this object (rule 7); the IPC socket path is a convention,
 * not configuration, so it is not part of this shape (see `ConfigComponent.socketEndpoint`).
 * `skills` and `mcp` are optional external-capability sections.
 */
export interface FlyflorConfig {
    runtime: {
        mode: RuntimeRoute;
    };
    llm: LlmConfig;
    sandbox: SandboxConfig;
    storage: StorageConfig;
    skills?: SkillsConfig;
    mcp?: MCPConfig;
}

/**
 * The global configuration component: the single owner of process paths and the parsed config snapshot.
 *
 * Folding the former `paths.ts` in here keeps one authority for "where things are" — `rootPath`, `appPath`,
 * `resolveFromRoot`, and the encapsulated IPC `socketEndpoint`. It loads `./.config/config.jsonc` in `@Init`,
 * so the no-argument container can construct it and every dependent resolves one consistent startup snapshot.
 */
@Component()
export class ConfigComponent extends FComponent {
    /** Repo-relative JSONC config file (rule 7). Defined once here — the only place the literal lives. */
    private static readonly CONFIG_FILE = "./.config/config.jsonc";
    /** POSIX Unix-domain socket file used for IPC. */
    private static readonly SOCKET_FILE = "./flyflor.sock";
    /** Windows named-pipe endpoint used in place of the socket file. */
    private static readonly WINDOWS_PIPE = "\\\\.\\pipe\\flyflor";

    /** Working/project root that owns `.config/`, `prompts/`, `sql/`, and where `flyflor.sock` is created. */
    public readonly rootPath: string = process.cwd();
    /** Source/application root (`src/` under `rootPath`). */
    public readonly appPath: string = resolve(process.cwd(), "src");

    /** The parsed config snapshot; populated by `init()` during startup. */
    private snapshot?: FlyflorConfig;

    /**
     * Loads the config during container initialization, before any dependent module's own `@Init` runs.
     */
    @Init()
    public async init(): Promise<void> {
        await this.load();
    }

    /**
     * Resolves a repo-relative path against `rootPath`.
     * @param relative - a path relative to the working root.
     * @returns the absolute filesystem path.
     */
    public resolveFromRoot(relative: string): string {
        return resolve(this.rootPath, relative);
    }

    /**
     * The encapsulated IPC endpoint: `./flyflor.sock` on POSIX, the named pipe on Windows.
     * Consumers see one address and never branch on platform themselves (rule 8).
     */
    public get socketEndpoint(): string {
        return process.platform === "win32" ? ConfigComponent.WINDOWS_PIPE : ConfigComponent.SOCKET_FILE;
    }

    /**
     * Reads and parses the JSONC config file from disk and caches the snapshot.
     * @returns the parsed config.
     */
    public async load(): Promise<FlyflorConfig> {
        const raw = await readFile(this.resolveFromRoot(ConfigComponent.CONFIG_FILE), "utf8");
        const config = this.parseJsonc(raw);
        this.snapshot = config;
        return config;
    }

    /**
     * Returns the loaded config snapshot.
     * @returns the cached config; throws if accessed before `init()`/`load()` ran.
     */
    public get value(): FlyflorConfig {
        if (this.snapshot === undefined) {
            throw new Error("Config has not been loaded");
        }
        return this.snapshot;
    }

    /**
     * Parses JSONC (JSON with `//` line comments) into a validated `FlyflorConfig`.
     * @param raw - the file contents.
     * @returns the parsed, runtime-mode-validated config.
     */
    private parseJsonc(raw: string): FlyflorConfig {
        const withoutLineComments = raw
            .split("\n")
            .map((line) => {
                const marker = line.indexOf("//");
                return marker < 0 ? line : line.slice(0, marker);
            })
            .join("\n");
        const parsed = JSON.parse(withoutLineComments) as FlyflorConfig;

        if (parsed.runtime.mode !== RuntimeRoute.Fast && parsed.runtime.mode !== RuntimeRoute.Thinking) {
            throw new Error("Invalid runtime mode in config");
        }
        return parsed;
    }
}
