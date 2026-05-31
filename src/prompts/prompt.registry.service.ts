import { readFileSync } from "node:fs";
import { Service } from "../di";
import { ConfigService } from "../config/config.service";
import type { PromptProtocol, PromptTemplateContext } from "./prompts.types";

/**
 * Loads and caches runtime prompts, resolves template variables.
 *
 * @usage Inject this service wherever prompts need to be loaded or resolved.
 */
@Service()
export class PromptRegistryService {
  private readonly cache = new Map<string, string>();

  public constructor(private readonly configService = new ConfigService()) {}

  /**
   * Loads a prompt file by project-relative path.
   *
   * @param relativePath - Project-relative .md prompt path.
   * @returns UTF-8 prompt text.
   * @usage Caches on first read; safe to call repeatedly.
   */
  public load(relativePath: string): string {
    const cached = this.cache.get(relativePath);
    if (cached) {
      return cached;
    }
    if (!relativePath.endsWith(".md") || relativePath.endsWith(".zh.cn.md")) {
      throw new Error(`Prompt path must be an English .md file: ${relativePath}`);
    }
    const content = readFileSync(this.configService.resolve(relativePath), "utf8").trim();
    this.cache.set(relativePath, content);
    return content;
  }

  /**
   * Resolves template variables in prompt text.
   *
   * @param prompt - Raw prompt text with {{PLACEHOLDER}} variables.
   * @param context - Values to inject.
   * @returns Prompt with variables replaced.
   * @usage Call before passing prompt text to model.
   */
  public resolve(prompt: string, context: PromptTemplateContext): string {
    return prompt
      .replaceAll("{{WORKSPACE_ROOT}}", context.workspaceRoot)
      .replaceAll("{{AVAILABLE_TOOLS}}", context.availableTools ?? "")
      .replaceAll("{{MAX_STEPS}}", String(context.maxSteps ?? 8))
      .replaceAll("{{PARENT_TASK}}", context.parentTask ?? "")
      .replaceAll("{{CURRENT_DATE}}", context.currentDate);
  }

  /**
   * Loads and resolves a prompt in one call.
   *
   * @param relativePath - Project-relative .md prompt path.
   * @param context - Template variable context.
   * @returns Resolved prompt text.
   * @usage Convenience method for worker and agent prompt injection.
   */
  public loadAndResolve(relativePath: string, context: PromptTemplateContext): string {
    const raw = this.load(relativePath);
    return this.resolve(raw, context);
  }

  /**
   * Lists all registered prompt protocols.
   *
   * @returns Protocol entries for all known prompt files.
   * @usage Diagnostics and socket debug surfaces use this.
   */
  public listProtocols(): readonly PromptProtocol[] {
    return [
      { name: "system", owner: "system", path: "./prompts/system.md", role: "system" },
      { name: "intent", owner: "intent", path: "./prompts/intent.md", role: "system" },
      { name: "ask-schema", owner: "system", path: "./prompts/ask.schema.md", role: "system" },
      { name: "agent-explore", owner: "worker", path: "./prompts/agent-explore.md", role: "system" },
      { name: "agent-discuss", owner: "worker", path: "./prompts/agent-discuss.md", role: "system" },
      { name: "agent-code", owner: "worker", path: "./prompts/agent-code.md", role: "system" },
      { name: "agent-general", owner: "worker", path: "./prompts/agent-general.md", role: "system" },
      { name: "agent-investigate", owner: "worker", path: "./prompts/agent-investigate.md", role: "system" },
      { name: "crystal-gem-summarize", owner: "crystal", path: "./prompts/crystal-gem-summarize.md", role: "system" },
      { name: "blackboard-role", owner: "blackboard", path: "./prompts/blackboard-role.md", role: "system" },
      { name: "blackboard-synthesize", owner: "blackboard", path: "./prompts/blackboard-synthesize.md", role: "system" },
      { name: "forgetting-compact", owner: "forgetting", path: "./prompts/forgetting-compact.md", role: "system" },
      { name: "forgetting-drift", owner: "forgetting", path: "./prompts/forgetting-drift.md", role: "system" },
    ];
  }
}
