#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPromptTemplatesDoc } from "../src/agent/prompts/template.docs.ts";
import {
    PROMPT_TEMPLATE_BUNDLE_MANIFEST,
    PROMPT_TEMPLATE_MANIFEST_FILE,
} from "../src/agent/prompts/template.manifest.ts";

const repoRoot = join(import.meta.dir, "..");
const readmePath = join(repoRoot, "README.md");
const manifestPath = join(repoRoot, "templates", "prompts", PROMPT_TEMPLATE_MANIFEST_FILE);
const startMarker = "<!-- flyflor:prompt-templates:start -->";
const endMarker = "<!-- flyflor:prompt-templates:end -->";

const args = new Set(process.argv.slice(2));
const writeMode = args.has("--write");
const checkMode = args.has("--check");

const generated = renderPromptTemplatesDoc().trimEnd() + "\n";
const generatedManifest = `${JSON.stringify(PROMPT_TEMPLATE_BUNDLE_MANIFEST, null, 2)}\n`;

if (writeMode) {
    const readme = await readFile(readmePath, "utf8");
    await writeFile(readmePath, replacePromptTemplateSection(readme, generated), "utf8");
    await writeFile(manifestPath, generatedManifest, "utf8");
    console.log(`wrote ${readmePath}`);
    console.log(`wrote ${manifestPath}`);
} else if (checkMode) {
    const current = extractPromptTemplateSection(await readFile(readmePath, "utf8"));
    if (current.trimEnd() !== generated.trimEnd()) {
        console.error(`prompt template docs drift: ${readmePath}`);
        process.exit(1);
    }
    const currentManifest = await readFile(manifestPath, "utf8");
    if (currentManifest.trimEnd() !== generatedManifest.trimEnd()) {
        console.error(`prompt template manifest drift: ${manifestPath}`);
        process.exit(1);
    }
    console.log(`ok ${readmePath}`);
    console.log(`ok ${manifestPath}`);
} else {
    process.stdout.write(generated);
}

function replacePromptTemplateSection(readme: string, section: string): string {
    const start = readme.indexOf(startMarker);
    const end = readme.indexOf(endMarker);
    if (start === -1 || end === -1 || end < start) {
        return `${readme.trimEnd()}\n\n${startMarker}\n${section.trimEnd()}\n${endMarker}\n`;
    }
    return `${readme.slice(0, start + startMarker.length)}\n${section.trimEnd()}\n${readme.slice(end)}`;
}

function extractPromptTemplateSection(readme: string): string {
    const start = readme.indexOf(startMarker);
    const end = readme.indexOf(endMarker);
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`Missing prompt template section markers in ${readmePath}`);
    }
    return readme.slice(start + startMarker.length, end).trim();
}
