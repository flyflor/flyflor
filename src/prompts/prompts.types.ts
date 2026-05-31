/**
 * Describes one registered prompt protocol entry.
 *
 * @property name - Stable protocol identifier.
 * @property owner - System that owns this prompt.
 * @property path - Project-relative prompt file path.
 * @property role - Model message role for prompt injection.
 * @property variables - Optional template variable placeholders.
 * @usage PromptRegistryService uses this to enumerate and load prompts.
 */
export interface PromptProtocol {
  readonly name: string;
  readonly owner: "system" | "intent" | "worker" | "crystal" | "blackboard" | "forgetting" | "sandbox";
  readonly path: string;
  readonly role: "system" | "user";
  readonly variables?: readonly string[];
}

/**
 * Describes a template variable substitution context.
 *
 * @property workspaceRoot - Absolute project root path.
 * @property availableTools - Tool descriptions for agent profiles.
 * @property maxSteps - Maximum tool-calling steps.
 * @property parentTask - Parent task description from the spawning context.
 * @property currentDate - ISO date string for the current day.
 * @usage PromptRegistryService.resolve() injects these values into prompt templates.
 */
export interface PromptTemplateContext {
  readonly workspaceRoot: string;
  readonly availableTools?: string;
  readonly maxSteps?: number;
  readonly parentTask?: string;
  readonly currentDate: string;
}
