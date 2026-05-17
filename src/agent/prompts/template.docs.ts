import {
    AskReason,
    EqLabel,
    GhostContextReason,
    GhostDecisionKind,
    MarkdownMemoryFile,
    MemoryKind,
    MemoryActionTarget,
} from "../../protocol/contracts/index.ts";
import {
    PROMPT_TEMPLATE_BUNDLE_VERSION,
    PROMPT_TEMPLATE_DEFINITIONS,
    PROMPT_TEMPLATE_MANIFEST_FILE,
    PROMPT_TEMPLATE_ORDER,
} from "./template.manifest.ts";

export function renderPromptTemplatesDoc(): string {
    const lines: string[] = [];
    // 中文备注：这里是文档生成器，不是运行时提示词；正文统一输出英文，便于审阅和 diff。
    // EN note: this is a docs generator, not runtime prompt text; the body stays English for review and diffs.
    lines.push("# Prompt Template System");
    lines.push("");
    lines.push("## One-line Summary");
    lines.push("");
    lines.push(
        "All model-facing instructions live in `templates/prompts/`, grouped by topic; `*.md` files are the runtime canonical templates.",
    );
    lines.push("");
    lines.push("## Related Paths");
    lines.push("");
    lines.push("- `src/agent/prompts/index.ts` - all render entry points");
    lines.push("- `src/agent/prompts/template.manifest.ts` - template bundle version and file contract");
    lines.push("- `src/agent/prompts/template.docs.ts` - docs generator");
    lines.push("- `templates/prompts/` - built-in templates");
    lines.push("- `scripts/install.templates.ts` - install into the config directory");
    lines.push("- `~/.flyflor/.config/prompts/` - user override directory");
    lines.push("");
    lines.push("## Bundle Version");
    lines.push("");
    lines.push(`- Version: \`v${PROMPT_TEMPLATE_BUNDLE_VERSION}\``);
    lines.push(`- Manifest file: \`${PROMPT_TEMPLATE_MANIFEST_FILE}\``);
    lines.push(
        "- Runtime checks the manifest version first, then reads each template by filename; missing files, empty files, and stale versions all fail with a reinstall hint.",
    );
    lines.push(
        "- The manifest also records each template key, runtime filename, protocol metadata, protocol-specific envelope data, and required placeholders; lint compares it with runtime definitions to prevent partial bundle upgrades.",
    );
    lines.push(
        "- `blackboard.worker.envelope.md` keeps its output schema and constraints in manifest metadata, then renders them into the JSON envelope at runtime.",
    );
    lines.push("");
    lines.push("## Template Catalog");
    lines.push("");
    lines.push("| Template | Runtime File | Caller | Protocol | Purpose | Required Placeholders |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const key of PROMPT_TEMPLATE_ORDER) {
        const spec = PROMPT_TEMPLATE_DEFINITIONS[key];
        lines.push(
            `| \`${spec.filename}\` | \`${spec.filename}\` | \`${spec.callSite}\` | ${formatProtocol(spec.protocol)} | ${escapeTableCell(spec.summary)} | ${formatPlaceholders(spec.requiredPlaceholders)} |`,
        );
    }
    lines.push("");
    lines.push("## Assembly Flow");
    lines.push("");
    lines.push("```mermaid");
    lines.push("flowchart LR");
    lines.push('    Turn["RuntimeModule.handleMessage"] --> Build["buildPrompt"]');
    lines.push('    Build --> R1["renderMemoryPrompt(memory.context.md)"]');
    lines.push('    Build --> R2["renderSkillContextPrompt(skill.context.md)"]');
    lines.push('    Build --> R3["renderMcpContextPrompt(mcp.context.md)"]');
    lines.push('    Build --> R4["renderBlackboardAdvisoryPrompt(blackboard.advisory.md)"]');
    lines.push('    R1 --> Sys["renderRuntimeSystemPrompt(runtime.system.md)"]');
    lines.push("    R2 --> Sys");
    lines.push("    R3 --> Sys");
    lines.push("    R4 --> Sys");
    lines.push('    Sys --> Out["Final system prompt"]');
    lines.push("```");
    lines.push("");
    lines.push("## Install Flow");
    lines.push("");
    lines.push("```mermaid");
    lines.push("flowchart LR");
    lines.push('    Builtin["templates/prompts/*.md"] -- bun run scripts/install.templates.ts --> Userdir["~/.flyflor/.config/prompts/"]');
    lines.push('    Userdir -- runtime override --> Render["render functions"]');
    lines.push('    Builtin -- canonical --> Render');
    lines.push("```");
    lines.push("");
    lines.push("- A same-named file in the user directory overrides the built-in template; the install script syncs the bundle and manifest together.");
    lines.push("- Runtime only loads canonical `.md` template files.");
    lines.push("- `*.zh.cn.md` files are audit-only mirrors synced by the install script; they do not enter the runtime bundle, manifest, or lint contract.");
    lines.push("");
    lines.push("## Data Contract");
    lines.push("");
    lines.push("Every template must guarantee:");
    lines.push("");
    lines.push("1. The model emits structured JSON sections by schema (routing, reflection, feedback, memory actions, dream evaluation, cluster summaries, and so on), while code only validates shape, enums, and ranges.");
    lines.push("2. Template-facing enum values come from `src/protocol/contracts/enums.ts`; add new enums there before updating templates.");
    lines.push("3. Templates must not allow the model to invent undeclared fields; extra fields are always discarded.");
    lines.push("");
    lines.push("## Prompt-facing Enums");
    lines.push("");
    lines.push(renderEnumList("MemoryActionTarget", Object.values(MemoryActionTarget)));
    lines.push(renderEnumList("MemoryKind", Object.values(MemoryKind)));
    lines.push(renderEnumList("MarkdownMemoryFile", Object.values(MarkdownMemoryFile)));
    lines.push(renderEnumList("AskReason", Object.values(AskReason)));
    lines.push(renderEnumList("GhostContextReason", Object.values(GhostContextReason)));
    lines.push(renderEnumList("GhostDecisionKind", Object.values(GhostDecisionKind)));
    lines.push(renderEnumList("EqLabel", Object.values(EqLabel)));
    lines.push("");
    lines.push("## Model Readability");
    lines.push("");
    lines.push("Runtime-injected templates should only contain instructions the model can act on directly: when to use them, what structure to emit, what each field means, and how to resolve conflicts. Internal route ids, TODO ids, phase names, and implementation metaphors must not appear in runtime prompts, including `LF-R*` or engineering-only labels such as “hippocampus / crystal / Dream / Gem.”");
    lines.push("");
    lines.push("Internal identifiers may stay in archived planning docs, design docs, code comments, and test names; model-facing templates must translate them into plain source labels and behavior descriptions such as “recently activated memory,” “current project notes,” “open items,” and “quiet maintenance phase.”");
    lines.push("");
    lines.push("## Release Checks");
    lines.push("");
    lines.push("- Template lint already checks required files, non-empty content, required placeholders, and unknown prompt files, and it blocks runtime prompt bodies that expose internal route ids or unexplained engineering metaphors; the bundle manifest version and template catalog are validated too.");
    lines.push("- The manifest integrity test compares the canonical templates under `templates/prompts/`; unregistered runtime prompt files must not appear in the directory, and `lintPromptTemplates` performs the same checks in the user directory.");
    lines.push("- `*.zh.cn.md` mirrors do not participate in runtime assembly or manifest comparison; they are for human review and audit only.");
    lines.push("- `template.docs.ts` renders the template matrix and prompt-facing enum snapshot into reviewable documentation, while `scripts/prompt.templates.docs.ts` can generate or check the same output and sync the prompt bundle manifest.");
    lines.push("- Runtime only assembles canonical `.md` files.");
    lines.push("");
    lines.push("## Related Tests");
    lines.push("");
    lines.push("- `tests/prompt.lint.test.ts`");
    lines.push("- `tests/prompt.templates.docs.test.ts`");
    lines.push("- `tests/blackboard.boundaries.test.ts`");
    lines.push("- `tests/eq.prompt.test.ts`");
    lines.push("- `tests/ask.parse.test.ts`");
    return lines.join("\n");
}

function renderEnumList(name: string, values: readonly string[]): string {
    return `- \`${name}\`: ${values.map((value) => `\`${value}\``).join(" / ")}`;
}

function formatPlaceholders(placeholders: readonly string[]): string {
    if (placeholders.length === 0) {
        return "—";
    }
    return placeholders.map((item) => `\`${item}\``).join(" / ");
}

function formatProtocol(protocol: string | undefined): string {
    return protocol ? `\`${protocol}\`` : "—";
}

function escapeTableCell(text: string): string {
    return text.replace(/\|/gu, "\\|");
}
