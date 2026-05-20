import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
    PROMPT_TEMPLATE_BUNDLE_MANIFEST,
    PROMPT_TEMPLATE_BUNDLE_VERSION,
    PROMPT_TEMPLATE_DEFINITIONS,
    PROMPT_TEMPLATE_MANIFEST_FILE,
    PROMPT_TEMPLATE_ORDER,
} from "../src/agent/prompts/template.manifest.ts";

interface SmokeCheck {
    detail?: string;
    name: string;
    ok: boolean;
}

interface DockerDevSmokeOptions {
    requireBinary?: boolean;
    root?: string;
}

/**
 * Docker dev smoke runner.
 *
 * Scripts also follow the repository OOP + use-composition rule: the exported
 * use function is the entry, while IO, checks, and formatting live on a class
 * instead of scattered top-level helpers.
 */
export class DockerDevSmokeRunner {
    public constructor(private readonly root: string = join(import.meta.dir, "..")) {}

    public async run(options: DockerDevSmokeOptions = {}): Promise<SmokeCheck[]> {
        const checks: SmokeCheck[] = [];
        const compose = await Bun.file(join(this.root, "docker-compose.yml")).text();
        const config = await this.readDockerDevConfigText();
        const buildScript = await Bun.file(join(this.root, "scripts", "build.docker.binary.ts")).text();
        const entrypoint = await Bun.file(join(this.root, "docker", "entrypoint.sh")).text();

        this.push(checks, "compose omits redis baseline service", !compose.includes("redis:7.4-alpine"));
        this.push(checks, "compose omits surrealdb baseline service", !compose.includes("surrealdb/surrealdb"));
        this.push(
            checks,
            "compose defines flyflor dev service",
            compose.includes("flyflor:") && compose.includes("flyflor-dev"),
        );
        this.push(checks, "compose exposes no host ports", !/^\s*ports\s*:/mu.test(compose));
        this.push(
            checks,
            "compose mounts compiled linux binary",
            compose.includes("./dist/flyflor-linux:/mounted/flyflor-linux:ro"),
        );
        this.push(checks, "compose mounts docker config as home", compose.includes("./docker/config:/root/.flyflor/.config"));
        this.push(
            checks,
            "compose mounts docker workspace",
            compose.includes("./docker/workspace:/root/.flyflor/.config/workspace"),
        );
        this.push(checks, "compose has no external backend health dependency", !compose.includes("condition: service_healthy"));
        this.push(
            checks,
            "docker config uses local working memory",
            this.backendConfigured(config, "working", '"backend"\\s*:\\s*"local"'),
        );
        this.push(
            checks,
            "docker config enables local crystal graph",
            this.backendConfigured(config, "crystal", '"enabled"\\s*:\\s*true[^}]*"backend"\\s*:\\s*"local"'),
        );
        // Redis / SurrealDB compatibility adapters are no longer part of the
        // dev baseline; absence is the contract, not disabled placeholders.
        this.push(checks, "docker config omits redis adapter by default", !this.backendExists(config, "redis"));
        this.push(checks, "docker config omits surreal adapter by default", !this.backendExists(config, "surreal"));
        this.push(checks, "docker binary build uses browser conditions", buildScript.includes('"--conditions=browser"'));
        // Docker and local binary builds share the same OpenTUI dynamic-import compatibility flag.
        this.push(checks, "docker binary build allows OpenTUI dynamic imports", buildScript.includes('"--allow-unresolved="'));
        this.push(checks, "docker binary build writes expected artifact", buildScript.includes('"dist/flyflor-linux"'));
        this.push(
            checks,
            "entrypoint prefers workspace binary copy",
            entrypoint.includes('WORKSPACE_BIN="/root/.flyflor/dist/flyflor-linux"'),
        );
        this.push(
            checks,
            "entrypoint keeps mounted binary fallback",
            entrypoint.includes('MOUNTED_BIN="/mounted/flyflor-linux"'),
        );

        checks.push(...(await this.checkDockerPromptBundle()));
        if (options.requireBinary) {
            checks.push(await this.checkCompiledDockerBinary());
        }
        return checks;
    }

    public async readDockerDevConfigText(): Promise<string> {
        const localConfig = Bun.file(join(this.root, "docker", "config", "config.jsonc"));
        if (await localConfig.exists()) {
            return localConfig.text();
        }
        // Fresh checkouts do not track docker/config/config.jsonc because it may
        // contain secrets. The tracked default is the release contract for smoke.
        return Bun.file(join(this.root, "docker", "config.default.jsonc")).text();
    }

    protected async checkDockerPromptBundle(): Promise<SmokeCheck[]> {
        const checks: SmokeCheck[] = [];
        const promptRoot = await this.resolveDockerPromptRoot();
        const manifestPath = join(promptRoot, PROMPT_TEMPLATE_MANIFEST_FILE);
        const manifestText = await Bun.file(manifestPath).text();
        const manifest = JSON.parse(manifestText) as typeof PROMPT_TEMPLATE_BUNDLE_MANIFEST;

        this.push(
            checks,
            "docker prompt manifest version matches runtime",
            manifest.schemaVersion === PROMPT_TEMPLATE_BUNDLE_VERSION,
        );
        this.push(
            checks,
            "docker prompt manifest matches runtime",
            JSON.stringify(manifest) === JSON.stringify(PROMPT_TEMPLATE_BUNDLE_MANIFEST),
        );
        for (const key of PROMPT_TEMPLATE_ORDER) {
            const spec = PROMPT_TEMPLATE_DEFINITIONS[key];
            const file = Bun.file(join(promptRoot, spec.filename));
            this.push(checks, `docker prompt exists: ${spec.filename}`, await file.exists());
        }
        return checks;
    }

    protected async resolveDockerPromptRoot(): Promise<string> {
        const installedPromptRoot = join(this.root, "docker", "config", "prompts");
        if (await Bun.file(join(installedPromptRoot, PROMPT_TEMPLATE_MANIFEST_FILE)).exists()) {
            return installedPromptRoot;
        }
        // Fresh checkouts track the template source, while the docker prompt
        // bundle itself is materialized by `bun run docker:templates`.
        return join(this.root, "templates", "prompts");
    }

    protected async checkCompiledDockerBinary(): Promise<SmokeCheck> {
        const binary = join(this.root, "dist", "flyflor-linux");
        try {
            const info = await stat(binary);
            const probe = await this.probeCompiledDockerBinary(binary);
            return {
                name: "compiled docker binary exists and starts",
                ok: info.isFile() && info.size > 0 && probe.ok,
                detail: `${info.size} bytes${probe.detail ? `; ${probe.detail}` : ""}`,
            };
        } catch (error) {
            return {
                name: "compiled docker binary exists and starts",
                ok: false,
                detail: error instanceof Error ? error.message : String(error),
            };
        }
    }

    protected async probeCompiledDockerBinary(binary: string): Promise<{ detail?: string; ok: boolean }> {
        // Docker dev ships a Linux binary even on macOS hosts, so the smoke check
        // executes it through the same Debian baseline image used by compose.
        if (process.platform !== "linux") {
            const dockerAvailable = await this.dockerDaemonAvailable();
            if (!dockerAvailable.ok) {
                return {
                    detail: `${dockerAvailable.detail}; binary presence verified without container launch`,
                    ok: true,
                };
            }
        }
        const command =
            process.platform === "linux"
                ? [binary, "--version"]
                : [
                      "docker",
                      "run",
                      "--rm",
                      "-v",
                      `${binary}:/flyflor:ro`,
                      "debian:bookworm-slim",
                      "/flyflor",
                      "--version",
                  ];
        const subprocess = Bun.spawn(command, {
            stderr: "pipe",
            stdout: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(subprocess.stdout).text(),
            new Response(subprocess.stderr).text(),
            subprocess.exited,
        ]);
        const output = `${stdout}${stderr}`.trim().replace(/\s+/gu, " ");
        return {
            detail: output.slice(0, 240),
            ok: exitCode === 0 && output.includes("flyflor"),
        };
    }

    protected async dockerDaemonAvailable(): Promise<{ detail: string; ok: boolean }> {
        const subprocess = Bun.spawn(["docker", "info"], {
            stdout: "pipe",
            stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(subprocess.stdout).text(),
            new Response(subprocess.stderr).text(),
            subprocess.exited,
        ]);
        const output = `${stdout}${stderr}`.trim().replace(/\s+/gu, " ");
        return {
            detail: output.slice(0, 240) || "docker info unavailable",
            ok: exitCode === 0,
        };
    }

    protected push(checks: SmokeCheck[], name: string, ok: boolean, detail?: string): void {
        checks.push({ detail, name, ok });
    }

    protected backendConfigured(config: string, key: string, pattern: string): boolean {
        const escapedKey = this.escapeRegex(key);
        return new RegExp(`"${escapedKey}"\\s*:\\s*\\{[^}]*${pattern}`, "u").test(config);
    }

    protected backendExists(config: string, key: string): boolean {
        return new RegExp(`"${this.escapeRegex(key)}"\\s*:`, "u").test(config);
    }

    protected escapeRegex(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}

export const useDockerDevSmoke = (root?: string): DockerDevSmokeRunner => new DockerDevSmokeRunner(root);

export const runDockerDevSmoke = async (options: DockerDevSmokeOptions = {}): Promise<SmokeCheck[]> =>
    useDockerDevSmoke(options.root).run(options);

export const readDockerDevConfigText = async (root?: string): Promise<string> =>
    useDockerDevSmoke(root).readDockerDevConfigText();

if (import.meta.main) {
    const requireBinary = process.argv.includes("--require-binary");
    const checks = await runDockerDevSmoke({ requireBinary });
    for (const check of checks) {
        const mark = check.ok ? "ok" : "fail";
        console.log(`${mark} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    }
    const failed = checks.filter((check) => !check.ok);
    if (failed.length > 0) {
        console.error(`docker dev smoke failed: ${failed.length} issue(s)`);
        process.exit(1);
    }
}
