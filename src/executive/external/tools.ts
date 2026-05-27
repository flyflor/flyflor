import { join } from "node:path";
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
import {
    ExternalToolStabilityComponent,
    type ExternalToolStability,
    type ExternalToolUpgradeState,
} from "./stability.ts";

export interface ExternalToolManifestFile {
    readonly schemaVersion?: 1 | 2;
    readonly sidecars?: Record<string, ExternalToolSidecarShape>;
}

export interface ExternalToolSidecarShape {
    readonly args?: string[];
    readonly command?: string;
    readonly config?: Record<string, unknown>;
    readonly cwd?: "project" | "app" | "config" | "workspace";
    readonly enabled?: boolean;
    readonly env?: Record<string, string>;
    readonly maxOutputBytes?: number;
    readonly mock?: boolean;
    readonly compatibleCore?: string;
    readonly packageId?: string;
    readonly packageVersion?: string;
    readonly protocolVersion?: string;
    readonly timeoutMs?: number;
    readonly tools?: string[];
    readonly upgrade?: ExternalToolUpgradeState;
}

export interface ExternalToolDefinition {
    readonly available: boolean;
    readonly sidecarId?: string;
    readonly stability: ExternalToolStability;
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
    readonly config?: Record<string, unknown>;
    readonly cwd: "project" | "app" | "config" | "workspace";
    readonly enabled: boolean;
    readonly env?: Record<string, string>;
    readonly id: string;
    readonly maxOutputBytes: number;
    readonly mock: boolean;
    readonly compatibleCore?: string;
    readonly manifestSource: "global" | "project";
    readonly packageId?: string;
    readonly packageVersion?: string;
    readonly protocolVersion?: string;
    readonly schemaVersion?: 1 | 2;
    readonly timeoutMs: number;
    readonly tools: readonly string[];
    readonly upgrade?: ExternalToolUpgradeState;
}

interface ResolvedSidecar {
    readonly available: boolean;
    readonly executor?: ToolManifestExecutor;
    readonly id: string;
    readonly reason?: string;
    readonly stability: ExternalToolStability;
    readonly tools: readonly string[];
}

const EXTERNAL_TOOL_SCHEMA_VERSION = 2;
const EXTERNAL_SIDECAR_MAX_TIMEOUT_MS = 120_000;
const EXTERNAL_SIDECAR_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const EXTERNAL_TOOL_SPECS: readonly ExternalToolSpec[] = [
    browserTool("browser.open", "Open a URL in the external browser sidecar.", false, ["url"]),
    browserTool("browser.snapshot", "Read the external browser accessibility snapshot.", true),
    browserTool("browser.screenshot", "Capture the external browser viewport.", true),
    browserUseTool(),
    browserTool("browser.click", "Click a target in the external browser.", false, ["target"]),
    browserTool("browser.type", "Type text into the external browser.", false, ["target", "text"]),
    browserTool("browser.navigate", "Navigate the external browser.", false, ["url"]),
    browserTool("browser.evaluate", "Evaluate script through the external browser sidecar.", false, ["script"]),
    computerTool("screen.screenshot", "Capture the current screen through the external sidecar.", ComputerControlAction.Screen, true),
    computerUseTool(),
    computerTool("computer.mouse", "Control the mouse through the external computer sidecar.", ComputerControlAction.Mouse, false),
    computerTool("computer.keyboard", "Control the keyboard through the external computer sidecar.", ComputerControlAction.Keyboard, false),
    computerTool("computer.window", "Control windows through the external computer sidecar.", ComputerControlAction.Window, false),
    mediaTool("vision.analyze", "Analyze an image through an external vision sidecar.", ToolPermission.Read, true),
    mediaTool("vision.ocr", "Extract text from an image through an external OCR sidecar.", ToolPermission.Read, true),
    mediaTool("audio.transcribe", "Transcribe audio through an external speech sidecar.", ToolPermission.Read, true),
    mediaTool("audio.speak", "Speak text through an external TTS sidecar.", ToolPermission.Message, false),
    networkTool("web.search", "Search the web through an external web sidecar.", ["query"]),
    networkTool("web.fetch", "Fetch a URL through an external web sidecar.", ["url"]),
    networkTool("web.extract", "Extract readable content from a URL through an external web sidecar.", ["url"]),
    networkTool("web.download", "Download a URL to an allowed output path through an external web sidecar.", ["url", "path"]),
    codingTool("lsp.symbols", "Read workspace symbols through an external LSP sidecar."),
    codingTool("lsp.diagnostics", "Read workspace diagnostics through an external LSP sidecar."),
    utilityTool("file.hash", "Hash a project file through an external utility sidecar.", ToolPermission.Read, true, ["path"]),
    utilityTool("archive.create", "Create an archive through an external utility sidecar.", ToolPermission.Write, false, ["paths", "output"]),
    utilityTool("archive.extract", "Extract an archive through an external utility sidecar.", ToolPermission.Write, false, ["archive", "outputDir"]),
    utilityTool("data.convert", "Convert small structured data through an external utility sidecar.", ToolPermission.Write, false, ["from", "to", "input"]),
    utilityTool("task.background", "Start or inspect an external background task sidecar.", ToolPermission.Execute, false, ["task"], [ToolScope.Background, ToolScope.Core]),
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
    private readonly stability = new ExternalToolStabilityComponent();

    public async load(paths: FlyflorPaths): Promise<ExternalToolDefinition[]> {
        const [globalFile, projectFile] = await Promise.all([
            this.read(paths, { global: true }),
            this.read(paths),
        ]);
        const sidecars = await this.resolveSidecars(paths, this.mergeSidecars(globalFile, projectFile));
        const specsByName = new Map(EXTERNAL_TOOL_SPECS.map((spec) => [spec.name, spec]));
        const sidecarByTool = this.sidecarByTool(sidecars, specsByName);

        return Promise.all(EXTERNAL_TOOL_SPECS.map((spec) => {
            const sidecar = sidecarByTool.get(spec.name);
            return this.definitionFor(paths, spec, sidecar);
        }));
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
        return EXTERNAL_TOOL_SPECS.map((spec) => this.cloneSpec(spec));
    }

    public normalize(file: ExternalToolManifestFile): readonly NormalizedSidecar[] {
        const manifest = this.normalizeManifestFile(file);
        return Object.entries(manifest.sidecars ?? {}).map(([id, shape]) =>
            this.normalizeSidecar(id, shape, manifest.schemaVersion, "project")
        );
    }

    private async definitionFor(
        paths: FlyflorPaths,
        spec: ExternalToolSpec,
        sidecar: ResolvedSidecar | undefined,
    ): Promise<ExternalToolDefinition> {
        const available = sidecar?.available === true;
        const tags = sidecar
            ? [...spec.tags, `sidecar:${sidecar.id}`]
            : [...spec.tags, "sidecar:missing"];
        const stability = sidecar?.stability ?? await this.stability.inspect(paths, {
            cwd: "app",
            discovery: "missing",
            manifest: "valid",
            toolNames: [spec.name],
        });
        return {
            available,
            sidecarId: sidecar?.id,
            stability,
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
                stability,
            },
            unavailableReason: available ? undefined : sidecar?.reason ?? stability.reason,
        };
    }

    private async resolveSidecars(
        paths: FlyflorPaths,
        sidecars: readonly NormalizedSidecar[],
    ): Promise<ResolvedSidecar[]> {
        return Promise.all(sidecars.map((sidecar) => this.resolveSidecar(paths, sidecar)));
    }

    private async resolveSidecar(paths: FlyflorPaths, sidecar: NormalizedSidecar): Promise<ResolvedSidecar> {
        const discovery = !sidecar.enabled ? "disabled" : sidecar.command ? "configured" : "missing";
        const stability = await this.stability.inspect(paths, {
            command: sidecar.command,
            compatibleCore: sidecar.compatibleCore,
            cwd: sidecar.cwd,
            discovery,
            manifest: "valid",
            manifestSource: sidecar.manifestSource,
            packageId: sidecar.packageId,
            packageVersion: sidecar.packageVersion,
            protocolVersion: sidecar.protocolVersion,
            schemaVersion: sidecar.schemaVersion,
            sidecarId: sidecar.id,
            toolNames: sidecar.tools,
            upgrade: sidecar.upgrade,
        });
        if (!sidecar.enabled) {
            return { available: false, id: sidecar.id, reason: stability.reason, stability, tools: sidecar.tools };
        }
        if (!sidecar.command) {
            return {
                available: false,
                id: sidecar.id,
                reason: stability.reason,
                stability,
                tools: sidecar.tools,
            };
        }
        if (stability.effective !== "available" && stability.effective !== "degraded") {
            return {
                available: false,
                id: sidecar.id,
                reason: stability.reason,
                stability,
                tools: sidecar.tools,
            };
        }
        return {
            available: true,
            executor: {
                args: sidecar.args,
                command: sidecar.command,
                config: sidecar.config,
                cwd: sidecar.cwd,
                env: sidecar.env,
                kind: "process-json",
                maxOutputBytes: sidecar.maxOutputBytes,
                timeoutMs: sidecar.timeoutMs,
            },
            id: sidecar.id,
            stability,
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
        const merged = new Map<string, NormalizedSidecar>();
        for (const [id, shape] of Object.entries(globalFile.sidecars ?? {})) {
            merged.set(id, this.normalizeSidecar(id, shape, globalFile.schemaVersion, "global"));
        }
        for (const [id, shape] of Object.entries(projectFile.sidecars ?? {})) {
            merged.set(id, this.normalizeSidecar(id, shape, projectFile.schemaVersion, "project"));
        }
        return [...merged.values()];
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

    private normalizeSidecar(
        id: string,
        shape: ExternalToolSidecarShape,
        schemaVersion: 1 | 2 | undefined,
        manifestSource: "global" | "project",
    ): NormalizedSidecar {
        const path = `sidecars.${id}`;
        return {
            args: this.optionalStringArray(shape.args, `${path}.args`) ?? [],
            command: this.optionalNonEmptyString(shape.command, `${path}.command`),
            config: this.optionalObject(shape.config, `${path}.config`, true) as Record<string, unknown> | undefined,
            compatibleCore: this.optionalNonEmptyString(shape.compatibleCore, `${path}.compatibleCore`),
            cwd: this.optionalCwd(shape.cwd, `${path}.cwd`) ?? "project",
            enabled: this.optionalBoolean(shape.enabled, `${path}.enabled`) ?? true,
            env: this.optionalStringRecord(shape.env, `${path}.env`),
            id,
            manifestSource,
            maxOutputBytes: this.optionalBoundedPositiveInt(shape.maxOutputBytes, `${path}.maxOutputBytes`, EXTERNAL_SIDECAR_MAX_OUTPUT_BYTES) ?? 64 * 1024,
            mock: this.optionalBoolean(shape.mock, `${path}.mock`) ?? false,
            packageId: this.optionalNonEmptyString(shape.packageId, `${path}.packageId`),
            packageVersion: this.optionalNonEmptyString(shape.packageVersion, `${path}.packageVersion`),
            protocolVersion: this.optionalNonEmptyString(shape.protocolVersion, `${path}.protocolVersion`),
            schemaVersion,
            timeoutMs: this.optionalBoundedPositiveInt(shape.timeoutMs, `${path}.timeoutMs`, EXTERNAL_SIDECAR_MAX_TIMEOUT_MS) ?? 10_000,
            tools: this.optionalToolNames(shape.tools, `${path}.tools`) ?? EXTERNAL_TOOL_SPECS.map((spec) => spec.name),
            upgrade: this.optionalUpgrade(shape.upgrade, `${path}.upgrade`),
        };
    }

    private optionalUpgrade(value: unknown, path: string): ExternalToolUpgradeState | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (value !== "idle" && value !== "staged" && value !== "applying" && value !== "rollback-required" && value !== "failed") {
            throw new Error(`${path} must be idle, staged, applying, rollback-required or failed.`);
        }
        return value;
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

    private optionalSchemaVersion(value: unknown, path: string): 1 | 2 | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (value !== 1 && value !== EXTERNAL_TOOL_SCHEMA_VERSION) {
            throw new Error(`${path} must be 1 or 2.`);
        }
        return value;
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

    private optionalObject(value: unknown, path: string, allowUndefined: boolean): Readonly<Record<string, unknown>> | undefined {
        if (value === undefined && allowUndefined) {
            return undefined;
        }
        return this.requiredObject(value, path);
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

    private optionalCwd(value: unknown, path: string): "project" | "app" | "config" | "workspace" | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (value !== "project" && value !== "app" && value !== "config" && value !== "workspace") {
            throw new Error(`${path} must be project, app, config or workspace.`);
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

    private optionalBoundedPositiveInt(value: unknown, path: string, max: number): number | undefined {
        const number = this.optionalPositiveInt(value, path);
        if (number === undefined) {
            return undefined;
        }
        if (number > max) {
            throw new Error(`${path} must be <= ${max}.`);
        }
        return number;
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

    private cloneSpec(spec: ExternalToolSpec): ExternalToolSpec {
        return {
            ...spec,
            computer: spec.computer ? { ...spec.computer } : undefined,
            inputSchema: structuredClone(spec.inputSchema) as ExecutiveJsonObject,
            scope: [...spec.scope],
            tags: [...spec.tags],
        };
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

function browserUseTool(): ExternalToolSpec {
    return {
        category: ToolCategory.Computer,
        computer: {
            action: ComputerControlAction.Browser,
            observationOnly: false,
            requiresFocusTarget: true,
        },
        concurrencySafe: false,
        description: "Opt-in high-privilege browser control sidecar. Prefer snapshot/screenshot/read actions first; use click/type/evaluate only for explicit browser tasks, never as a replacement for workspace, git, process, or file tools.",
        exclusive: true,
        inputSchema: {
            type: "object",
            required: ["action"],
            properties: {
                action: {
                    type: "string",
                    enum: [
                        "open",
                        "navigate",
                        "snapshot",
                        "screenshot",
                        "click",
                        "type",
                        "evaluate",
                        "wait",
                    ],
                },
                captureAfter: { type: "boolean" },
                captureMode: { type: "string", enum: ["snapshot", "screenshot"] },
                format: { type: "string" },
                ms: { type: "number" },
                script: { type: "string" },
                seconds: { type: "number" },
                target: { type: "string" },
                text: { type: "string" },
                url: { type: "string" },
            },
        },
        name: "browser.use",
        permission: ToolPermission.Computer,
        readOnly: false,
        resultLimit: 24_000,
        scope: [ToolScope.Local, ToolScope.Debug],
        tags: ["external-tool", "sidecar", "browser", "browser-use", "approval:computer"],
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

function computerUseTool(): ExternalToolSpec {
    const coordinateSchema = {
        type: "array",
        items: { type: "integer" },
        minItems: 2,
        maxItems: 2,
    };
    return {
        category: ToolCategory.Computer,
        computer: {
            action: ComputerControlAction.Computer,
            observationOnly: false,
            requiresFocusTarget: true,
        },
        concurrencySafe: false,
        description: "Opt-in high-privilege desktop control sidecar. Prefer capture/list_apps/wait observation first; use mouse, keyboard, app focus, or value changes only for explicit desktop tasks, never as a replacement for workspace, git, process, or file tools.",
        exclusive: true,
        inputSchema: {
            type: "object",
            required: ["action"],
            properties: {
                action: {
                    type: "string",
                    enum: [
                        "capture",
                        "click",
                        "double_click",
                        "right_click",
                        "middle_click",
                        "drag",
                        "scroll",
                        "type",
                        "key",
                        "set_value",
                        "wait",
                        "list_apps",
                        "focus_app",
                    ],
                },
                amount: { type: "integer", minimum: 1, maximum: 1000 },
                app: { type: "string" },
                button: { type: "string", enum: ["left", "right", "middle"] },
                captureAfter: { type: "boolean" },
                capture_after: { type: "boolean" },
                coordinate: coordinateSchema,
                direction: { type: "string", enum: ["up", "down", "left", "right"] },
                element: { type: "integer", minimum: 1 },
                from_coordinate: coordinateSchema,
                from_element: { type: "integer", minimum: 1 },
                fromCoordinate: coordinateSchema,
                fromElement: { type: "integer", minimum: 1 },
                max_elements: { type: "integer", minimum: 1, maximum: 1000 },
                keys: { type: "string" },
                maxElements: { type: "integer", minimum: 1, maximum: 1000 },
                mode: { type: "string", enum: ["som", "vision", "ax"] },
                modifiers: { type: "array", items: { type: "string", enum: ["cmd", "shift", "option", "alt", "ctrl", "fn"] } },
                raiseWindow: { type: "boolean" },
                raise_window: { type: "boolean" },
                seconds: { type: "number" },
                text: { type: "string" },
                to_coordinate: coordinateSchema,
                to_element: { type: "integer", minimum: 1 },
                toCoordinate: coordinateSchema,
                toElement: { type: "integer", minimum: 1 },
                value: { type: "string" },
            },
        },
        name: "computer.use",
        permission: ToolPermission.Computer,
        readOnly: false,
        resultLimit: 24_000,
        scope: [ToolScope.Local, ToolScope.Debug],
        tags: ["external-tool", "sidecar", "computer", "computer-use", "approval:computer"],
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

function networkTool(name: string, description: string, required: readonly string[] = []): ExternalToolSpec {
    return {
        category: ToolCategory.Network,
        concurrencySafe: true,
        description,
        exclusive: false,
        inputSchema: objectSchema(required),
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

function utilityTool(
    name: string,
    description: string,
    permission: ToolPermissionType,
    readOnly: boolean,
    required: readonly string[],
    scope: readonly ToolScopeType[] = [ToolScope.Workspace],
): ExternalToolSpec {
    return {
        category: ToolCategory.System,
        concurrencySafe: readOnly,
        description,
        exclusive: !readOnly,
        inputSchema: objectSchema(required),
        name,
        permission,
        readOnly,
        resultLimit: 16_000,
        scope,
        tags: ["external-tool", "sidecar", "utility", readOnly ? "approval:read" : "approval:execute"],
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
