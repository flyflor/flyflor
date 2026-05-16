import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const checkedExtensions = new Set([".css", ".json", ".md", ".ts", ".vue"]);
const allowedIndentMod = 4;

const failures: string[] = [];

async function collectFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".nuxt" || entry.name === ".output") {
            continue;
        }

        const fullPath = join(directory, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await collectFiles(fullPath)));
            continue;
        }

        if ([...checkedExtensions].some((extension) => entry.name.endsWith(extension))) {
            files.push(fullPath);
        }
    }

    return files;
}

function checkIndent(filePath: string, source: string): void {
    const lines = source.split("\n");

    lines.forEach((line, index) => {
        if (line.includes("\t")) {
            failures.push(`${relative(root, filePath)}:${index + 1} uses a tab character`);
            return;
        }

        const leadingSpaces = line.match(/^ */)?.[0].length ?? 0;

        if (leadingSpaces > 0 && leadingSpaces % allowedIndentMod !== 0) {
            failures.push(`${relative(root, filePath)}:${index + 1} indentation is not ${allowedIndentMod} spaces`);
        }
    });
}

function checkVueBlockOrder(filePath: string, source: string): void {
    if (!filePath.endsWith(".vue")) {
        return;
    }

    const templateIndex = source.indexOf("<template");
    const scriptIndex = source.indexOf("<script");
    const styleIndex = source.indexOf("<style");

    if (templateIndex === -1 || scriptIndex === -1 || styleIndex === -1) {
        failures.push(`${relative(root, filePath)} must include template, script, and style blocks`);
        return;
    }

    if (!(templateIndex < scriptIndex && scriptIndex < styleIndex)) {
        failures.push(`${relative(root, filePath)} must order blocks as template, script, style`);
    }
}

for (const file of await collectFiles(root)) {
    const source = await readFile(file, "utf8");

    checkIndent(file, source);
    checkVueBlockOrder(file, source);
}

if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
}

console.log("Flyflor front redlines passed.");
