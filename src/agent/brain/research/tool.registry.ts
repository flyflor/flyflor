import { FService, Inject, Service, type FTool, type ToolExecutionContext, type ToolParameterSchema } from '@/core';
import { AskTool, CodeGraphTool, ConfirmTool, ReadFileTool } from '@/plugins/tools';
import type { IntelligenceToolDefinition } from '../intelligence/types';

/**
 * The research tool set: selects the read-only tools the research loop may call, projects their schemas
 * for the provider, and dispatches a model tool call by name.
 *
 * This is a real object boundary, not a mirror inventory: it owns schema projection, name dispatch, and the
 * convert-result-to-text + never-throw policy the loop depends on. Tools arrive as DI property keys (the
 * minimum the container needs), filtered to `research`-eligible ones so write/edit tools can never be offered.
 */
@Service()
export class ToolRegistry extends FService {
    @Inject()
    public readFile!: ReadFileTool;

    @Inject()
    public codegraph!: CodeGraphTool;

    @Inject()
    public ask!: AskTool;

    @Inject()
    public confirm!: ConfirmTool;

    /**
     * The read-only tools advertised to the model this turn.
     * `research === true` is the gate, mirroring a read-only tool bundle: a non-research tool is never listed.
     */
    private tools(): FTool<Record<string, unknown>, unknown>[] {
        // Tool subclasses narrow `TInput`, which is contravariant in `execute`; the loop always dispatches
        // with a generic argument object, so we view them through the base input shape.
        const tools = [this.readFile, this.codegraph, this.ask, this.confirm] as unknown as FTool<Record<string, unknown>, unknown>[];
        return tools.filter((tool) => tool.research === true);
    }

    /**
     * Projects the active tools to provider function definitions.
     */
    public definitions(): IntelligenceToolDefinition[] {
        return this.project(this.tools());
    }

    /**
     * The evidence-gathering subset for an isolated investigation: read and search only.
     * A nested sub-agent has no user to talk to, so `ask`/`confirm` are excluded; this is the tool set a deep
     * investigation runs with.
     */
    public readOnlyDefinitions(): IntelligenceToolDefinition[] {
        const readOnly = this.tools().filter((tool) => tool.name === this.readFile.name || tool.name === this.codegraph.name);
        return this.project(readOnly);
    }

    private project(tools: FTool<Record<string, unknown>, unknown>[]): IntelligenceToolDefinition[] {
        return tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: this.jsonSchema(tool.parameters),
        }));
    }

    /**
     * Converts a Flyflor `ToolParameterSchema` to standard JSON Schema for the provider.
     * Flyflor marks required fields with a per-property `required: true`; JSON Schema (and strict providers
     * like DeepSeek) want an object-level `required` array and no per-property `required`. This collects the
     * required names and strips the per-property flag so every advertised tool schema validates.
     */
    private jsonSchema(parameters: ToolParameterSchema): Record<string, unknown> {
        const properties: Record<string, Record<string, unknown>> = {};
        const required: string[] = [];
        for (const [name, property] of Object.entries(parameters.properties)) {
            const { required: isRequired, ...rest } = property;
            properties[name] = rest;
            if (isRequired === true) required.push(name);
        }
        return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
    }

    /**
     * Runs one model tool call by name and returns a model-visible result string plus an error flag.
     * A missing tool, a failed `ToolResult`, or a thrown error all become a readable string so the loop can
     * surface the failure to the model instead of crashing the turn.
     */
    public async dispatch(name: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<{ content: string; isError: boolean }> {
        const tool = this.tools().find((candidate) => candidate.name === name);
        if (tool === undefined) {
            return { content: `Tool ${name} is not available during research.`, isError: true };
        }
        try {
            const result = await tool.execute(args, context);
            if (result.ok) return { content: this.render(result.data), isError: false };
            return { content: result.error, isError: true };
        } catch (error) {
            return { content: error instanceof Error ? error.message : String(error), isError: true };
        }
    }

    /**
     * Renders a tool's structured data into the text the model sees as the tool result.
     */
    private render(data: unknown): string {
        if (typeof data === 'string') return data;
        return JSON.stringify(data);
    }
}
