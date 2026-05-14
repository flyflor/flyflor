#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPromptTemplatesDoc } from "../src/agent/prompts/template.docs.ts";
import {
    PROMPT_TEMPLATE_BUNDLE_MANIFEST,
    PROMPT_TEMPLATE_MANIFEST_FILE,
} from "../src/agent/prompts/template.manifest.ts";

const repoRoot = join(import.meta.dir, "..");
const docPath = join(repoRoot, "docs", "prompt.templates.md");
const manifestPath = join(repoRoot, "templates", "prompts", PROMPT_TEMPLATE_MANIFEST_FILE);

const args = new Set(process.argv.slice(2));
const writeMode = args.has("--write");
const checkMode = args.has("--check");

const generated = renderPromptTemplatesDoc().trimEnd() + "\n";
const generatedManifest = `${JSON.stringify(PROMPT_TEMPLATE_BUNDLE_MANIFEST, null, 2)}\n`;

if (writeMode) {
    await writeFile(docPath, generated, "utf8");
    await writeFile(manifestPath, generatedManifest, "utf8");
    console.log(`wrote ${docPath}`);
    console.log(`wrote ${manifestPath}`);
} else if (checkMode) {
    const current = await readFile(docPath, "utf8");
    if (current.trimEnd() !== generated.trimEnd()) {
        console.error(`prompt template docs drift: ${docPath}`);
        process.exit(1);
    }
    const currentManifest = await readFile(manifestPath, "utf8");
    if (currentManifest.trimEnd() !== generatedManifest.trimEnd()) {
        console.error(`prompt template manifest drift: ${manifestPath}`);
        process.exit(1);
    }
    console.log(`ok ${docPath}`);
    console.log(`ok ${manifestPath}`);
} else {
    process.stdout.write(generated);
}
