import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { parseJsonc, type FlyflorPaths } from "../../config/index.ts";
import {
    CapabilitySource,
    ToolCategory,
    ToolPermission,
    ToolScope,
    type ToolCategory as ToolCategoryType,
    type ToolPermission as ToolPermissionType,
    type ToolScope as ToolScopeType,
} from "../../protocol/contracts/index.ts";
import {
    ComputerControlAction,
    type ComputerControlProfile,
    type ExecutiveJsonObject,
} from "../types.ts";
import type { ManifestToolDefinition, ToolManifestExecutor } from "../manifest.ts";

export interface ExternalToolManifestFile {
    readonly schemaVersion?: 1;
    readonly sidecars?: Record<string, ExternalToolSidecarShape>;
}

export interface ExternalToolSidecarShape {
    readonly args?: string[];
    readonly command?: string;
    readonly cwd?: "project" | "config";
    readonly enabled?: boolean;
    readonly env?: Record<string, string>;
    readonly maxOutputBytes?: number;
    readonly mock?: boolean;
    readonly timeoutMs?: number;
    readonly tools?: string[];
}

export interface ExternalToolDefinition {
    readonly available: boolean;
    readonly sidecarId?: string;
    readonly tool: ManifestToolDefinition;
    readonly unavailableReason?: string;
}

export interface ExternalToolSpec {
    readonly category: ToolCategoryType;
    readonly computer?: ComputerControlProfile;
    readonly concurrencySafe: boolean;
    readonly description: string;
    readonly exclusive: boolean;
    readonly inputSchema: ExecutiveJsonObject;
    readonly name: string;
    readonly permission: ToolPermissionType;
    readonly readOnly: boolean;
    readonly resultLimit: number;
    readonly scope: readonly ToolScopeType[];
    readonly tags: readonly string[];
}

interface NormalizedSidecar {
    readonly args: readonly string[];
    readonly command?: string;
    readonly cwd: "project" | "config";
    readonly enabled: boolean;
    readonly env?: Record<string, string>;
    readonly id: string;
    readonly maxOutputBytes: number;
    readonly mock: boolean;
    readonly timeoutMs: number;
    readonly tools: readonly string[];
}

interface ResolvedSidecar {
    readonly available: boolean;
    readonly executor?: ToolManifestExecutor;
    readonly id: string;
    readonly reason?: string;
    readonly tools: readonly string[];
}

const EXTERNAL_TOOL_SCHEMA_VERSION = 1;

const EXTERNAL_TOOL_SPECS: readonly ExternalToolSpec[] = [
    browserTool("browser.open", "Open a URL in the external browser sidecar.", false, ["url"]),
    browserTool("browser.snapshot", "Read the external browser accessibility snapshot.", true),
    browserTool("browser.screenshot", "Capture the external browser viewport.", true),
    browserTool("browser.click", "Click a target in the external browser.", false, ["target"]),
    browserTool("browser.type", "Type text into the external browser.", false, ["target", "text"]),
    browserTool("browser.navigate", "Navigate the external browser.", false, ["url"]),
    browserTool("browser.evaluate", "Evaluate script through the external browser sidecar.", false, ["script"]),
    computerTool("screen.screenshot", "Capture the current screen through the external sidecar.", ComputerControlAction.Screen, true),
    computerTool("computer.mouse", "Control the mouse through the external computer sidecar.", ComputerControlAction.Mouse, false),
    computerTool("computer.keyboard", "Control the keyboard through the external computer sidecar.", ComputerControlAction.Keyboard, false),
    computerTool("computer.window", "Control windows through the external computer sidecar.", ComputerControlAction.Window, false),
    mediaTool("vision.analyze", "Analyze an image through an external vision sidecar.", ToolPermission.Read, true),
    mediaTool("vision.ocr", "Extract text from an image through an external OCR sidecar.", ToolPermission.Read, true),
    mediaTool("audio.transcribe", "Transcribe audio through an external speech sidecar.", ToolPermission.Read, true),
    mediaTool("audio.speak", "Speak text through an external TTS sidecar.", ToolPermission.Message, false),
    networkTool("web.fetch", "Fetch a URL through an external web sidecar."),
    networkTool("web.search", "Search the web through an external web sidecar."),
    codingTool("lsp.symbols", "Read workspace symbols through an external LSP sidecar."),
    codingTool("lsp.diagnostics", "Read workspace diagnostics through an external LSP sidecar."),
    {
        category: ToolCategory.System,
        concurrencySafe: true,
        description: "Start or inspect an external background task sidecar.",
        exclusive: false,
        inputSchema: objectSchema(["task"]),
        name: "task.background",
        permission: ToolPermission.Execute,
        readOnly: false,
        resultLimit: 8_000,
        scope: [ToolScope.Background, ToolScope.Core],
        tags: ["external-tool", "sidecar", "approval:execute"],
    },
];

/**
 * Owns descriptor-only external tool discovery.
 *
 * The Bun kernel never imports browser, OCR, TTS, Playwright or LSP runtimes.
 * Sidecar manifests only describe a process-json adapter; missing commands are
 * surfaced as unavailable descriptors so core startup and catalog construction
 * stay deterministic.
 */
export class ExternalToolDescriptorComponent {
    public async load(paths: FlyflorPaths): Promise<ExternalToolDefinition[]> {
        const [globalFile, projectFile] = await Promise.all([
            this.read(paths, { global: true }),
            this.read(paths),
        ]);
        const sidecars = await this.resolveSidecars(paths, this.mergeSidecars(globalFile, projectFile));
        const specsByName = new Map(EXTERNAL_TOOL_SPECS.map((spec) => [spec.name, spec]));
        const sidecarByTool = this.sidecarByTool(sidecars, specsByName);

        return EXTERNAL_TOOL_SPECS.map((spec) => {
            const sidecar = sidecarByTool.get(spec.name);
            return this.definitionFor(spec, sidecar);
        });
    }

    public async read(
        paths: FlyflorPaths,
        options: { global?: boolean } = {},
    ): Promise<ExternalToolManifestFile> {
        const file = Bun.file(this.path(paths, options));
        if (!(await file.exists())) {
            return {};
        }
        return this.normalizeManifestFile(parseJsonc(await file.text()));
    }

    public path(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
        const root = options.global
            ? paths.toolDir ?? join(paths.configDir, "tools")
            : paths.projectToolDir ?? join(paths.projectFlyflorDir, "tools");
        return join(root, "external.tools.jsonc");
    }

    public specs(): readonly ExternalToolSpec[] {
        return EXTERNAL_TOOL_SPECS;
    }

    public normalize(file: ExternalToolManifestFile): readonly NormalizedSidecar[] {
        const manifest = this.normalizeManifestFile(file);
        return Object.entries(manifest.sidecars ?? {}).map(([id, shape]) => this.normalizeSidecar(id, shape));
    }

    private definitionFor(spec: ExternalToolSpec, sidecar: ResolvedSidecar | undefined): ExternalToolDefinition {
        const available = sidecar?.available === true;
        const tags = sidecar
            ? [...spec.tags, `sidecar:${sidecar.id}`]
            : [...spec.tags, "sidecar:missing"];
        return {
            available,
            sidecarId: sidecar?.id,
            tool: {
                descriptor: {
                    category: spec.category,
                    computer: spec.computer,
                    concurrencySafe: spec.concurrencySafe,
                    description: spec.description,
                    exclusive: spec.exclusive,
                    inputSchema: spec.inputSchema,
                    name: spec.name,
                    permission: spec.permission,
                    readOnly: spec.readOnly,
                    resultLimit: { maxChars: spec.resultLimit },
                    scope: spec.scope,
                    source: CapabilitySource.User,
                    sourceId: sidecar ? `external:${sidecar.id}` : "external:missing",
                    tags,
                },
                enabled: true,
                executor: sidecar?.executor,
                manifestSource: "project",
            },
            unavailableReason: available ? undefined : sidecar?.reason ?? "external sidecar is not configured",
        };
    }

    private async resolveSidecars(
        paths: FlyflorPaths,
        sidecars: readonly NormalizedSidecar[],
    ): Promise<ResolvedSidecar[]> {
        return Promise.all(sidecars.map((sidecar) => this.resolveSidecar(paths, sidecar)));
    }

    private async resolveSidecar(paths: FlyflorPaths, sidecar: NormalizedSidecar): Promise<ResolvedSidecar> {
        if (!sidecar.enabled) {
            return { available: false, id: sidecar.id, reason: "external sidecar is disabled", tools: sidecar.tools };
        }
        if (!sidecar.command) {
            return {
                available: false,
                id: sidecar.id,
                reason: "external sidecar command is not configured",
                tools: sidecar.tools,
            };
        }
        if (!(await this.commandExists(paths, sidecar))) {
            return {
                available: false,
                id: sidecar.id,
                reason: "external sidecar command is unavailable",
                tools: sidecar.tools,
            };
        }
        return {
            available: true,
            executor: {
                args: sidecar.args,
                command: sidecar.command,
                cwd: sidecar.cwd,
                env: sidecar.env,
                kind: "process-json",
                maxOutputBytes: sidecar.maxOutputBytes,
                timeoutMs: sidecar.timeoutMs,
            },
            id: sidecar.id,
            tools: sidecar.tools,
        };
    }

    private sidecarByTool(
        sidecars: readonly ResolvedSidecar[],
        specsByName: ReadonlyMap<string, ExternalToolSpec>,
    ): Map<string, ResolvedSidecar> {
        const byTool = new Map<string, ResolvedSidecar>();
        for (const sidecar of sidecars) {
            for (const tool of sidecar.tools) {
                if (specsByName.has(tool) && !byTool.has(tool)) {
                    byTool.set(tool, sidecar);
                }
            }
        }
        return byTool;
    }

    private mergeSidecars(
        globalFile: ExternalToolManifestFile,
        projectFile: ExternalToolManifestFile,
    ): readonly NormalizedSidecar[] {
        const merged = {
            ...(globalFile.sidecars ?? {}),
            ...(projectFile.sidecars ?? {}),
        };
        return Object.entries(merged).map(([id, shape]) => this.normalizeSidecar(id, shape));
    }

    private async commandExists(paths: FlyflorPaths, sidecar: NormalizedSidecar): Promise<boolean> {
        const command = sidecar.command;
        if (!command) {
            return false;
        }
        const candidate = this.commandCandidate(paths, command, sidecar.cwd);
        if (candidate) {
            return this.pathExists(candidate);
        }
        for (const dir of this.pathEntries()) {
            if (await this.pathExists(join(dir, command))) {
                return true;
            }
        }
        return false;
    }

    private commandCandidate(paths: FlyflorPaths, command: string, cwd: "project" | "config"): string | undefined {
        if (isAbsolute(command)) {
            return command;
        }
        const first = command.charAt(0);
        if (first === ".") {
            return join(cwd === "config" ? paths.configDir : paths.projectDir, command);
        }
        return undefined;
    }

    private pathEntries(): string[] {
        return (process.env.PATH ?? "")
            .split(delimiter)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    private async pathExists(path: string): Promise<boolean> {
        try {
            await access(path);
            return true;
        } catch {
            return false;
        }
    }

    private normalizeManifestFile(value: unknown): ExternalToolManifestFile {
        if (value === undefined || value === null) {
            return {};
        }
        const file = this.requiredObject(value, "external.tools.jsonc");
        const schemaVersion = this.optionalSchemaVersion(file.schemaVersion, "schemaVersion");
        if (file.sidecars === undefined) {
            return schemaVersion === undefined ? {} : { schemaVersion };
        }
        const sidecars = this.requiredObject(file.sidecars, "sidecars");
        return {
            schemaVersion,
            sidecars: Object.fromEntries(
                Object.entries(sidecars).map(([id, shape]) => [
                    id,
                    this.requiredObject(shape, `sidecars.${id}`) as unknown as ExternalToolSidecarShape,
                ]),
            ),
        };
    }

    private normalizeSidecar(id: string, shape: ExternalToolSidecarShape): NormalizedSidecar {
        const path = `sidecars.${id}`;
        return {
            args: this.optionalStringArray(shape.args, `${path}.args`) ?? [],
            command: this.optionalNonEmptyString(shape.command, `${path}.command`),
            cwd: this.optionalCwd(shape.cwd, `${path}.cwd`) ?? "project",
            enabled: this.optionalBoolean(shape.enabled, `${path}.enabled`) ?? true,
            env: this.optionalStringRecord(shape.env, `${path}.env`),
            id,
            maxOutputBytes: this.optionalPositiveInt(shape.maxOutputBytes, `${path}.maxOutputBytes`) ?? 64 * 1024,
            mock: this.optionalBoolean(shape.mock, `${path}.mock`) ?? false,
            timeoutMs: this.optionalPositiveInt(shape.timeoutMs, `${path}.timeoutMs`) ?? 10_000,
            tools: this.optionalToolNames(shape.tools, `${path}.tools`) ?? EXTERNAL_TOOL_SPECS.map((spec) => spec.name),
        };
    }

    private optionalToolNames(value: unknown, path: string): readonly string[] | undefined {
        if (value === undefined) {
            return undefined;
        }
        const names = this.optionalStringArray(value, path);
        const known = new Set(EXTERNAL_TOOL_SPECS.map((spec) => spec.name));
        for (const name of names ?? []) {
            if (!known.has(name)) {
                throw new Error(`${path} contains unsupported external tool: ${name}.`);
            }
        }
        return names;
    }

    private optionalSchemaVersion(value: unknown, path: string): 1 | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (value !== EXTERNAL_TOOL_SCHEMA_VERSION) {
            throw new Error(`${path} must be 1.`);
        }
        return EXTERNAL_TOOL_SCHEMA_VERSION;
    }

    private optionalStringArray(value: unknown, path: string): readonly string[] | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (!Array.isArray(value)) {
            throw new Error(`${path} must be an array.`);
        }
        return value.map((entry, index) => this.requiredString(entry, `${path}.${index}`));
    }

    private optionalStringRecord(value: unknown, path: string): Record<string, string> | undefined {
        if (value === undefined) {
            return undefined;
        }
        const object = this.requiredObject(value, path);
        return Object.fromEntries(
            Object.entries(object).map(([key, entry]) => [key, this.requiredString(entry, `${path}.${key}`)]),
        );
    }

    private optionalNonEmptyString(value: unknown, path: string): string | undefined {
        if (value === undefined) {
            return undefined;
        }
        const string = this.requiredString(value, path);
        if (string.length === 0) {
            throw new Error(`${path} must be a non-empty string.`);
        }
        return string;
    }

    private optionalCwd(value: unknown, path: string): "project" | "config" | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (value !== "project" && value !== "config") {
            throw new Error(`${path} must be project or config.`);
        }
        return value;
    }

    private optionalBoolean(value: unknown, path: string): boolean | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (typeof value !== "boolean") {
            throw new Error(`${path} must be a boolean.`);
        }
        return value;
    }

    private optionalPositiveInt(value: unknown, path: string): number | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
            throw new Error(`${path} must be a positive integer.`);
        }
        return value;
    }

    private requiredString(value: unknown, path: string): string {
        if (typeof value !== "string") {
            throw new Error(`${path} must be a string.`);
        }
        return value;
    }

    private requiredObject(value: unknown, path: string): Readonly<Record<string, unknown>> {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new Error(`${path} must be an object.`);
        }
        return value as Readonly<Record<string, unknown>>;
    }
}

function browserTool(name: string, description: string, readOnly: boolean, required: readonly string[] = []): ExternalToolSpec {
    return {
        category: ToolCategory.Computer,
        computer: {
            action: ComputerControlAction.Browser,
            observationOnly: readOnly,
            requiresFocusTarget: !readOnly,
        },
        concurrencySafe: false,
        description,
        exclusive: true,
        inputSchema: objectSchema(required),
        name,
        permission: ToolPermission.Computer,
        readOnly,
        resultLimit: readOnly ? 16_000 : 4_000,
        scope: [ToolScope.Local, ToolScope.Debug],
        tags: ["external-tool", "sidecar", "browser", "approval:computer"],
    };
}

function computerTool(
    name: string,
    description: string,
    action: ComputerControlAction,
    readOnly: boolean,
): ExternalToolSpec {
    return {
        category: ToolCategory.Computer,
        computer: {
            action,
            observationOnly: readOnly,
            requiresFocusTarget: !readOnly,
        },
        concurrencySafe: false,
        description,
        exclusive: true,
        inputSchema: objectSchema(),
        name,
        permission: ToolPermission.Computer,
        readOnly,
        resultLimit: readOnly ? 16_000 : 4_000,
        scope: [ToolScope.Local, ToolScope.Debug],
        tags: ["external-tool", "sidecar", "computer", "approval:computer"],
    };
}

function mediaTool(
    name: string,
    description: string,
    permission: ToolPermissionType,
    readOnly: boolean,
): ExternalToolSpec {
    return {
        category: ToolCategory.Media,
        concurrencySafe: readOnly,
        description,
        exclusive: !readOnly,
        inputSchema: objectSchema(),
        name,
        permission,
        readOnly,
        resultLimit: 16_000,
        scope: [ToolScope.Core],
        tags: ["external-tool", "sidecar", "media", readOnly ? "approval:read" : "approval:message"],
    };
}

function networkTool(name: string, description: string): ExternalToolSpec {
    return {
        category: ToolCategory.Network,
        concurrencySafe: true,
        description,
        exclusive: false,
        inputSchema: objectSchema(["url"]),
        name,
        permission: ToolPermission.Network,
        readOnly: true,
        resultLimit: 16_000,
        scope: [ToolScope.Core],
        tags: ["external-tool", "sidecar", "network", "approval:network"],
    };
}

function codingTool(name: string, description: string): ExternalToolSpec {
    return {
        category: ToolCategory.Coding,
        concurrencySafe: true,
        description,
        exclusive: false,
        inputSchema: objectSchema(),
        name,
        permission: ToolPermission.Read,
        readOnly: true,
        resultLimit: 16_000,
        scope: [ToolScope.Workspace],
        tags: ["external-tool", "sidecar", "lsp", "approval:read"],
    };
}

function objectSchema(required: readonly string[] = []): ExecutiveJsonObject {
    return required.length > 0
        ? { type: "object", required }
        : { type: "object" };
}

export async function loadExternalTools(paths: FlyflorPaths): Promise<ExternalToolDefinition[]> {
    return new ExternalToolDescriptorComponent().load(paths);
}

export function externalToolManifestPath(
    paths: FlyflorPaths,
    options: { global?: boolean } = {},
): string {
    return new ExternalToolDescriptorComponent().path(paths, options);
}

export function externalToolSpecs(): readonly ExternalToolSpec[] {
    return new ExternalToolDescriptorComponent().specs();
}
