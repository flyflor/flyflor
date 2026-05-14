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

export async function runDockerDevSmoke(options: DockerDevSmokeOptions = {}): Promise<SmokeCheck[]> {
    const root = options.root ?? join(import.meta.dir, "..");
    const checks: SmokeCheck[] = [];
    const composePath = join(root, "docker-compose.yml");
    const compose = await Bun.file(composePath).text();
    const config = await Bun.file(join(root, "docker", "config", "config.jsonc")).text();
    const buildScript = await Bun.file(join(root, "scripts", "build.docker.binary.ts")).text();
    const entrypoint = await Bun.file(join(root, "docker", "entrypoint.sh")).text();

    push(checks, "compose omits redis baseline service", !compose.includes("redis:7.4-alpine"));
    push(checks, "compose omits surrealdb baseline service", !compose.includes("surrealdb/surrealdb"));
    push(checks, "compose defines flyflor dev service", compose.includes("flyflor:") && compose.includes("flyflor-dev"));
    push(checks, "compose exposes no host ports", !/^\s*ports\s*:/mu.test(compose));
    push(checks, "compose mounts compiled linux binary", compose.includes("./dist/flyflor-linux:/mounted/flyflor-linux:ro"));
    push(checks, "compose mounts docker config as home", compose.includes("./docker/config:/root/.flyflor"));
    push(checks, "compose mounts docker workspace", compose.includes("./docker/workspace:/root/.flyflor/workspace"));
    push(checks, "compose has no external backend health dependency", !compose.includes("condition: service_healthy"));
    push(checks, "docker config uses local working memory", backendConfigured(config, "working", "\"backend\"\\s*:\\s*\"local\""));
    push(checks, "docker config disables redis by default", backendConfigured(config, "redis", "\"enabled\"\\s*:\\s*false"));
    push(checks, "docker config disables surreal by default", backendConfigured(config, "surreal", "\"enabled\"\\s*:\\s*false"));
    push(checks, "docker binary build uses browser conditions", buildScript.includes('"--conditions=browser"'));
    // Docker and local binary builds share the same OpenTUI dynamic-import compatibility flag.
    push(checks, "docker binary build allows OpenTUI dynamic imports", buildScript.includes('"--allow-unresolved="'));
    push(checks, "docker binary build writes expected artifact", buildScript.includes('"dist/flyflor-linux"'));
    push(checks, "entrypoint runs mounted binary copy", entrypoint.includes('SOURCE_BIN="/mounted/flyflor-linux"'));

    checks.push(...(await checkDockerPromptBundle(root)));
    if (options.requireBinary) {
        checks.push(await checkCompiledDockerBinary(root));
    }
    return checks;
}

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

async function checkDockerPromptBundle(root: string): Promise<SmokeCheck[]> {
    const checks: SmokeCheck[] = [];
    const manifestPath = join(root, "docker", "config", "prompts", PROMPT_TEMPLATE_MANIFEST_FILE);
    const manifestText = await Bun.file(manifestPath).text();
    const manifest = JSON.parse(manifestText) as typeof PROMPT_TEMPLATE_BUNDLE_MANIFEST;

    push(checks, "docker prompt manifest version matches runtime", manifest.schemaVersion === PROMPT_TEMPLATE_BUNDLE_VERSION);
    push(checks, "docker prompt manifest matches runtime", JSON.stringify(manifest) === JSON.stringify(PROMPT_TEMPLATE_BUNDLE_MANIFEST));
    for (const key of PROMPT_TEMPLATE_ORDER) {
        const spec = PROMPT_TEMPLATE_DEFINITIONS[key];
        const file = Bun.file(join(root, "docker", "config", "prompts", spec.filename));
        push(checks, `docker prompt exists: ${spec.filename}`, await file.exists());
    }
    return checks;
}

async function checkCompiledDockerBinary(root: string): Promise<SmokeCheck> {
    try {
        const info = await stat(join(root, "dist", "flyflor-linux"));
        return {
            name: "compiled docker binary exists",
            ok: info.isFile() && info.size > 0,
            detail: `${info.size} bytes`,
        };
    } catch (error) {
        return {
            name: "compiled docker binary exists",
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

function push(checks: SmokeCheck[], name: string, ok: boolean, detail?: string): void {
    checks.push({ detail, name, ok });
}

function backendConfigured(config: string, key: string, pattern: string): boolean {
    const escapedKey = escapeRegex(key);
    return new RegExp(
        `"${escapedKey}"\\s*:\\s*\\{[^}]*${pattern}`,
        "u",
    ).test(config);
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
