import type { ModelMessage } from "../../protocol/contracts/index.ts";
import { ModelRole } from "../../protocol/contracts/index.ts";
import type { McpServerDefinition, McpToolCatalogEntry } from "../mcp/index.ts";
import { renderMcpToolCatalog } from "../mcp/index.ts";
import {
    renderAskSchemaInstructions,
    renderBehaviorPriorityInstructions,
    renderMemoryActionInstructions,
    renderMcpContextPrompt,
    renderRuntimeSystemPrompt,
    renderSkillContextPrompt,
} from "../prompts/index.ts";
import type { Skill } from "../skills/index.ts";

export interface RuntimePromptContextInput {
    askSchemaInstructions?: string;
    behaviorPriorityInstructions?: string;
    blackboardContext: string;
    mcp: {
        canExecuteTools: boolean;
        servers: McpServerDefinition[];
        tools: McpToolCatalogEntry[];
    };
    memoryActionInstructions?: string;
    memoryContext: string;
    sandboxSummary: string;
    selectedSkills: Skill[];
}

/**
 * Context-owned prompt assembly for runtime turns.
 *
 * Runtime passes explicit scope/catalog/memory/skill fields here; this owner
 * renders model messages without inferring project, fork, tool, or business
 * intent from natural language.
 */
export function renderRuntimeModelMessages(input: {
    prompt: RuntimePromptContextInput;
    userContent: string;
}): ModelMessage[] {
    return [
        {
            role: ModelRole.System,
            content: renderRuntimeSystemPrompt({
                askSchemaInstructions: input.prompt.askSchemaInstructions ?? renderAskSchemaInstructions(),
                behaviorPriorityInstructions: input.prompt.behaviorPriorityInstructions ?? renderBehaviorPriorityInstructions(),
                blackboardContext: input.prompt.blackboardContext,
                mcpContext: renderMcpContextPrompt({
                    servers: input.prompt.mcp.servers,
                    toolContext: renderMcpToolCatalog({
                        canExecuteTools: input.prompt.mcp.canExecuteTools,
                        servers: input.prompt.mcp.servers,
                        tools: input.prompt.mcp.tools,
                    }),
                }),
                memoryActionInstructions: input.prompt.memoryActionInstructions ?? renderMemoryActionInstructions(),
                memoryContext: input.prompt.memoryContext,
                sandboxSummary: input.prompt.sandboxSummary,
                skillContext: renderSkillContextPrompt({ skills: input.prompt.selectedSkills }),
            }),
        },
        {
            role: ModelRole.User,
            content: input.userContent,
        },
    ];
}
