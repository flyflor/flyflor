import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    AskReason,
    ContinuationContextReason,
    ContinuationDecisionKind,
    EqLabel,
    MarkdownMemoryFile,
    MemoryActionTarget,
    MemoryKind,
} from "../../protocol/contracts/index.ts";
import { PROMPT_TEMPLATE_BUNDLE_VERSION, PROMPT_TEMPLATE_MANIFEST_FILE } from "./template.manifest.ts";

const DOC_TEMPLATE_DIR = join(import.meta.dir, "..", "..", "..", "templates", "prompts", "docs");
const DOC_TEMPLATE_FILE = "template.catalog.md";
const DOC_TEMPLATE_ZH_CN_FILE = "template.catalog.zh.cn.md";

export function renderPromptTemplatesDoc(): string {
    return renderDocTemplate(readDocTemplate(DOC_TEMPLATE_FILE));
}

export function renderPromptTemplatesZhCnDoc(): string {
    return renderDocTemplate(readDocTemplate(DOC_TEMPLATE_ZH_CN_FILE));
}

function readDocTemplate(filename: string): string {
    const path = join(DOC_TEMPLATE_DIR, filename);
    const text = readFileSync(path, "utf8").trim();
    if (!text) {
        throw new Error(`Empty prompt docs template: ${path}`);
    }
    return text;
}

function renderDocTemplate(template: string): string {
    return template
        .replaceAll("{{bundleVersion}}", String(PROMPT_TEMPLATE_BUNDLE_VERSION))
        .replaceAll("{{manifestFile}}", PROMPT_TEMPLATE_MANIFEST_FILE)
        .replaceAll("{{promptFacingEnums}}", renderPromptFacingEnums())
        .trim();
}

function renderPromptFacingEnums(): string {
    return [
        renderEnumList("MemoryActionTarget", Object.values(MemoryActionTarget)),
        renderEnumList("MemoryKind", Object.values(MemoryKind)),
        renderEnumList("MarkdownMemoryFile", Object.values(MarkdownMemoryFile)),
        renderEnumList("AskReason", Object.values(AskReason)),
        renderEnumList("ContinuationContextReason", Object.values(ContinuationContextReason)),
        renderEnumList("ContinuationDecisionKind", Object.values(ContinuationDecisionKind)),
        renderEnumList("EqLabel", Object.values(EqLabel)),
    ].join("\n");
}

function renderEnumList(name: string, values: readonly string[]): string {
    return `- \`${name}\`: ${values.map((value) => `\`${value}\``).join(" / ")}`;
}
