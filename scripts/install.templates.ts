import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

interface InstallOptions {
    docker: boolean;
    force: boolean;
    sourceConfig: boolean;
    targetHome: string;
}

const repoRoot = join(import.meta.dir, "..");

const args = new Set(process.argv.slice(2));
const explicitTarget = readArgValue("--target");
const options: InstallOptions = {
    docker: args.has("--docker"),
    force: args.has("--force"),
    sourceConfig: args.has("--source-config"),
    targetHome:
        explicitTarget ??
        // Default local script usage mirrors runtime config resolution:
        // templates live under the current source checkout's `.config`.
        (args.has("--docker") ? join(repoRoot, "docker", "config") : join(repoRoot, ".config")),
};

await installTemplateGroup({
    destination: join(options.targetHome, "prompts"),
    force: options.force,
    source: join(repoRoot, "templates", "prompts"),
});

await installTemplateGroup({
    destination: join(options.targetHome, "templates", "memory"),
    force: options.force,
    source: join(repoRoot, "templates", "memory"),
});
await pruneLegacyMemoryTemplates(options.targetHome);

await installTemplateGroup({
    destination: join(options.targetHome, "templates", "projects"),
    force: options.force,
    source: join(repoRoot, "templates", "projects"),
});

await installTemplateFile({
    destination: join(options.targetHome, "commands.jsonc"),
    force: options.force,
    source: join(repoRoot, "templates", "app.commands.jsonc"),
});

if (options.docker) {
    await installDockerDefaultConfig({
        destination: join(options.targetHome, "config.jsonc"),
        source: join(repoRoot, "docker", "config.default.jsonc"),
    });
} else if (options.sourceConfig) {
    await installSourceDefaultConfig({
        destination: join(options.targetHome, "config.jsonc"),
        source: join(repoRoot, "config.default.jsonc"),
    });
}

console.log(`Template install complete: ${options.targetHome}`);

async function installTemplateGroup(input: { destination: string; force: boolean; source: string }): Promise<void> {
    await mkdir(input.destination, { recursive: true });
    const entries = await readdir(input.source, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        if (entry.name === "docs") {
            continue;
        }
        const sourcePath = join(input.source, entry.name);
        const destinationPath = join(input.destination, entry.name);
        const destination = Bun.file(destinationPath);
        if (!input.force && (await destination.exists())) {
            console.log(`skip ${basename(destinationPath)}`);
            continue;
        }
        await copyFile(sourcePath, destinationPath);
        console.log(`${input.force ? "write" : "copy"} ${basename(destinationPath)}`);
    }
}

async function pruneLegacyMemoryTemplates(targetHome: string): Promise<void> {
    const memoryTemplateDir = join(targetHome, "templates", "memory");
    const entries = await readdir(memoryTemplateDir, { withFileTypes: true });
    const actualFiles = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const legacyFiles = [
        "MEMORY.md",
        "SELF.md",
        "SOUL.md",
        "SOUL.zh.cn.md",
        "USER.md",
        "soul.md",
        "soul.zh.cn.md",
    ];
    for (const file of legacyFiles) {
        if (!actualFiles.has(file)) {
            continue;
        }
        const path = join(memoryTemplateDir, file);
        try {
            await rm(path, { force: true });
        } catch (error) {
            throw new Error(`Failed to prune legacy memory template ${path}: ${String(error)}`);
        }
    }
}

async function installTemplateFile(input: { destination: string; force: boolean; source: string }): Promise<void> {
    await mkdir(dirname(input.destination), { recursive: true });
    const destination = Bun.file(input.destination);
    if (!input.force && (await destination.exists())) {
        console.log(`skip ${basename(input.destination)}`);
        return;
    }
    await copyFile(input.source, input.destination);
    console.log(`${input.force ? "write" : "copy"} ${basename(input.destination)}`);
}

async function installDockerDefaultConfig(input: { destination: string; source: string }): Promise<void> {
    await mkdir(dirname(input.destination), { recursive: true });
    const destination = Bun.file(input.destination);
    if (await destination.exists()) {
        // Docker config carries local provider secrets. Even --force template
        // refreshes must preserve this file and only update prompts/commands.
        console.log(`preserve ${basename(input.destination)}`);
        return;
    }
    await copyFile(input.source, input.destination);
    console.log(`copy ${basename(input.destination)}`);
}

async function installSourceDefaultConfig(input: { destination: string; source: string }): Promise<void> {
    await mkdir(dirname(input.destination), { recursive: true });
    const destination = Bun.file(input.destination);
    if (await destination.exists()) {
        console.log(`preserve ${basename(input.destination)}`);
        return;
    }
    await copyFile(input.source, input.destination);
    console.log(`copy ${basename(input.destination)}`);
}

function readArgValue(name: string): string | undefined {
    const prefix = `${name}=`;
    const direct = process.argv.find((arg) => arg.startsWith(prefix));
    if (direct) {
        return direct.slice(prefix.length);
    }
    const index = process.argv.indexOf(name);
    if (index >= 0) {
        return process.argv[index + 1];
    }
    return undefined;
}
