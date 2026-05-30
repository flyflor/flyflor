import { readFileSync } from "node:fs";
import { Service } from "../di";
import { ConfigService } from "../config/config.service";
import { TemplateLoaderComponent } from "../config/template-loader.component";
import { MemoryComponent } from "../memory";
import type { ContextBuildInput, ContextBuildResult, ContextMessage } from "./context.types";

/**
 * Builds deterministic no-session model context from local state.
 *
 * @usage AgentRuntimeService calls this on every turn instead of relying on provider sessions.
 */
@Service()
export class ContextBuilderService {
  public constructor(
    private readonly configService = new ConfigService(),
    templateLoader?: TemplateLoaderComponent,
    private readonly memoryComponent = new MemoryComponent(configService),
  ) {
    this.templateLoader = templateLoader ?? new TemplateLoaderComponent(configService);
  }

  private readonly templateLoader: TemplateLoaderComponent;

  /**
   * Builds the full model input for one turn.
   *
   * @param input - Conversation id, current user input, and runtime state.
   * @returns Ordered context messages plus recall diagnostics.
   * @usage Runtime passes this directly to the model provider adapter.
   */
  public build(input: ContextBuildInput): ContextBuildResult {
    const config = this.configService.getConfig();
    const recall = this.memoryComponent.recall(input.userInput, config.context.maxRecall, {
      conversationId: input.conversationId,
      excludeQuestionLike: true,
    });
    const recentMessages = this.memoryComponent
      .recentMessages(input.conversationId, config.context.recentTurns * 2)
      .filter((message) => message.id !== input.excludeMessageId);
    const checkpoint = this.memoryComponent.latestCheckpoint(input.conversationId);
    const systemSections = [
      ...this.templateLoader.readCoreTemplates().map((section) => `## ${section.name}\n\n${section.content.trim()}`),
      `## SYSTEM\n\n${readFileSync(this.configService.resolve(config.prompts.system), "utf8").trim()}`,
      `## RUNTIME\n\n${input.runtimeState ?? "runtime=ready"}`,
      `## MEMORY RECALL\n\n${this.renderRecall(recall)}`,
      `## CONTEXT CHECKPOINT\n\n${this.renderCheckpoint(checkpoint)}`,
    ];
    const messages: ContextMessage[] = [
      { role: "system", content: systemSections.join("\n\n") },
      ...recentMessages.map((message) => ({ role: message.role, content: message.content }) satisfies ContextMessage),
      { role: "user", content: input.userInput },
    ];
    return {
      messages,
      recall,
      checkpoint,
      recentMessages,
      estimatedChars: messages.reduce((total, message) => total + message.content.length, 0),
    };
  }

  /**
   * Renders recalled memories as compact Markdown.
   *
   * @param recall - Ranked memory recall items.
   * @returns Markdown bullet list for prompt injection.
   * @usage Keeps memory formatting stable across providers and tests.
   */
  private renderRecall(recall: ContextBuildResult["recall"]): string {
    if (recall.length === 0) {
      return "- No durable memory recalled.";
    }
    return recall
      .map((item) => `- [${item.chunk.sourceKind}:${item.chunk.sourceId} score=${item.score.toFixed(3)}] ${item.chunk.content}`)
      .join("\n");
  }

  /**
   * Renders the latest checkpoint as compact Markdown.
   *
   * @param checkpoint - Latest persisted checkpoint or undefined.
   * @returns Markdown checkpoint section.
   * @usage Keeps old-context summaries visible without replacing recent tail messages.
   */
  private renderCheckpoint(checkpoint: ContextBuildResult["checkpoint"]): string {
    if (!checkpoint) {
      return "- No context checkpoint.";
    }
    return [
      `- checkpoint=${checkpoint.id}`,
      `- sources=${checkpoint.sourceMessageIds.join(",") || "none"}`,
      checkpoint.summary,
    ].join("\n");
  }
}
