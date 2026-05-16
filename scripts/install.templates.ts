import { copyFile, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

interface InstallOptions {
    force: boolean;
    targetHome: string;
}

const repoRoot = join(import.meta.dir, "..");

const args = new Set(process.argv.slice(2));
const explicitTarget = readArgValue("--target");
const options: InstallOptions = {
    force: args.has("--force"),
    targetHome:
        explicitTarget ?? (args.has("--docker") ? join(repoRoot, "docker", "config") : join(homedir(), ".flyflor")),
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

console.log(`Template install complete: ${options.targetHome}`);

async function installTemplateGroup(input: { destination: string; force: boolean; source: string }): Promise<void> {
    await mkdir(input.destination, { recursive: true });
    const entries = await readdir(input.source, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) {
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
