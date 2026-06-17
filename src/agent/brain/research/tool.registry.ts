import { FService, Inject, RuntimeText, Service, type FTool, type ToolExecutionContext } from '@/core';
import { AskTool, ConfirmTool, ReadFileTool } from '@/plugins/tools';
import type { IntelligenceToolDefinition } from '../intelligence/types';
import type { ResearchToolDispatch, ResearchToolPreview } from './types';

const TOOL_MODEL_MAX_CHARS = 16000;
const TOOL_PREVIEW_MAX_CHARS = 4000;
const TOOL_RESULT_MIN_HEAD_CHARS = 2000;

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
    private readonly artifacts = new Map<string, ResearchToolDispatch['artifact']>();

    @Inject()
    public readFile!: ReadFileTool;

    @Inject()
    public ask!: AskTool;

    @Inject()
    public confirm!: ConfirmTool;

    @Inject()
    public runtimeText!: RuntimeText;

    public resetArtifacts(): void {
        this.artifacts.clear();
    }

    /**
     * The read-only tools advertised to the model this turn.
     * `research === true` is the gate, mirroring a read-only tool bundle: a non-research tool is never listed.
     */
    private tools(): FTool<Record<string, unknown>, unknown>[] {
        // Tool subclasses narrow `TInput`, which is contravariant in `execute`; the loop always dispatches
        // with a generic argument object, so we view them through the base input shape.
        const tools = [this.readFile, this.ask, this.confirm] as unknown as FTool<Record<string, unknown>, unknown>[];
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
        const readOnly = this.tools().filter((tool) => tool.name === this.readFile.name);
        return this.project(readOnly);
    }

    private project(tools: FTool<Record<string, unknown>, unknown>[]): IntelligenceToolDefinition[] {
        return tools.map((tool) => ({
            name: tool.name,
            description: this.runtimeText.tool(tool.name).description ?? tool.description,
            parameters: this.jsonSchema(tool),
        }));
    }

    /**
     * Converts a Flyflor `ToolParameterSchema` to standard JSON Schema for the provider.
     * Flyflor marks required fields with a per-property `required: true`; JSON Schema (and strict providers
     * like DeepSeek) want an object-level `required` array and no per-property `required`. This collects the
     * required names and strips the per-property flag so every advertised tool schema validates.
     */
    private jsonSchema(tool: FTool<Record<string, unknown>, unknown>): Record<string, unknown> {
        const properties: Record<string, Record<string, unknown>> = {};
        const required: string[] = [];
        const descriptions = this.runtimeText.tool(tool.name).parameters ?? {};
        for (const [name, property] of Object.entries(tool.parameters.properties)) {
            const { required: isRequired, ...rest } = property;
            properties[name] = { ...rest, ...(descriptions[name] === undefined ? {} : { description: descriptions[name] }) };
            if (isRequired === true) required.push(name);
        }
        return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
    }

    /**
     * Runs one model tool call by name and returns a model-visible result string plus an error flag.
     * A missing tool, a failed `ToolResult`, or a thrown error all become a readable string so the loop can
     * surface the failure to the model instead of crashing the turn.
     */
    public async dispatch(name: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<ResearchToolDispatch> {
        const tool = this.tools().find((candidate) => candidate.name === name);
        if (tool === undefined) {
            const content = this.runtimeText.text('research.toolUnavailable', { name });
            return {
                content,
                isError: true,
                preview: this.preview(context.callId, name, content, content, true),
            };
        }
        try {
            const result = await tool.execute(args, context);
            if (result.ok) return this.success(name, result.data, context);
            return this.failure(name, result.error, context);
        } catch (error) {
            return this.failure(name, error instanceof Error ? error.message : String(error), context);
        }
    }

    public blocked(name: string, reason: string, context: ToolExecutionContext): ResearchToolDispatch {
        return this.failure(name, reason, context);
    }

    /**
     * Renders a tool's structured data into the text the model sees as the tool result.
     */
    private render(data: unknown): string {
        if (typeof data === 'string') return data;
        if (this.isReadFileData(data)) {
            return [
                `path: ${data.path}`,
                `lines: ${data.startLine}-${data.endLine} of ${data.totalLines}`,
                `bytes: ${data.bytes}`,
                `truncated: ${data.truncated}`,
                `artifactId: ${this.artifactId(data) ?? 'none'}`,
                '',
                data.content,
            ].join('\n');
        }
        return JSON.stringify(data);
    }

    private success(name: string, data: unknown, context: ToolExecutionContext): ResearchToolDispatch {
        const rendered = this.render(data);
        const bytes = Buffer.byteLength(rendered, 'utf-8');
        const summary = this.summary(name, data, false);
        const content = this.modelContent(summary, rendered);
        return {
            content,
            isError: false,
            preview: this.preview(context.callId, name, summary, rendered, false, this.artifactId(data)),
            artifact: this.rememberArtifact(data, bytes, rendered, content.length < rendered.length),
        };
    }

    private failure(name: string, message: string, context: ToolExecutionContext): ResearchToolDispatch {
        const summary = this.runtimeText.text('research.toolResult.errorHeader', { name, summary: message });
        return {
            content: summary,
            isError: true,
            preview: this.preview(context.callId, name, summary, message, true),
        };
    }

    private modelContent(summary: string, rendered: string): string {
        const body = this.truncate(rendered, TOOL_MODEL_MAX_CHARS);
        return `${summary}\n\n${body}`;
    }

    public artifact(id: string): ResearchToolDispatch['artifact'] | undefined {
        return this.artifacts.get(id);
    }

    private preview(toolCallId: string, name: string, summary: string, rendered: string, isError: boolean, artifactId?: string): ResearchToolPreview {
        const preview = this.truncate(rendered, TOOL_PREVIEW_MAX_CHARS);
        const truncated = preview.length < rendered.length;
        return {
            toolCallId,
            name,
            kind: isError ? 'error' : truncated ? 'summary' : 'preview',
            status: isError ? 'error' : 'ok',
            summary,
            preview,
            bytes: Buffer.byteLength(rendered, 'utf-8'),
            truncated,
            ...(artifactId === undefined ? {} : { artifactId }),
        };
    }

    private rememberArtifact(data: unknown, bytes: number, content: string, truncated: boolean): ResearchToolDispatch['artifact'] {
        if (!data || typeof data !== 'object') return undefined;
        const artifact = (data as { artifact?: unknown }).artifact;
        if (!artifact || typeof artifact !== 'object') return undefined;
        const id = (artifact as { id?: unknown }).id;
        if (typeof id !== 'string' || id.length === 0) return undefined;
        const artifactBytes = (artifact as { bytes?: unknown }).bytes;
        const artifactContent = (artifact as { content?: unknown }).content;
        const artifactTruncated = (artifact as { truncated?: unknown }).truncated;
        const stored = {
            id,
            bytes: typeof artifactBytes === 'number' ? artifactBytes : bytes,
            truncated: typeof artifactTruncated === 'boolean' ? artifactTruncated : truncated,
            content: typeof artifactContent === 'string' ? artifactContent : content,
        };
        this.artifacts.set(id, stored);
        return stored;
    }

    private artifactId(data: unknown): string | undefined {
        if (!data || typeof data !== 'object') return undefined;
        const artifact = (data as { artifact?: unknown }).artifact;
        if (!artifact || typeof artifact !== 'object') return undefined;
        const id = (artifact as { id?: unknown }).id;
        return typeof id === 'string' && id.length > 0 ? id : undefined;
    }

    private summary(name: string, data: unknown, isError: boolean): string {
        if (isError) return this.runtimeText.text('research.toolResult.errorHeader', { name, summary: this.render(data) });
        if (this.isReadFileData(data)) {
            return this.runtimeText.text('research.toolResult.readFileHeader', {
                path: data.path,
                bytes: data.bytes,
                truncated: data.truncated,
            });
        }
        const rendered = this.render(data);
        return this.runtimeText.text('research.toolResult.genericHeader', {
            name,
            bytes: Buffer.byteLength(rendered, 'utf-8'),
            truncated: rendered.length > TOOL_MODEL_MAX_CHARS,
        });
    }

    private truncate(text: string, maxChars: number): string {
        if (text.length <= maxChars) return text;
        const notice = this.runtimeText.text('research.toolResult.truncationNotice', {
            chars: text.length - maxChars,
        });
        const budget = Math.max(0, maxChars - notice.length);
        if (budget <= 0) return notice.slice(0, maxChars);
        const tailImportant = this.hasImportantTail(text);
        if (tailImportant && budget > TOOL_RESULT_MIN_HEAD_CHARS * 2) {
            const marker = this.runtimeText.text('research.toolResult.middleOmission');
            const tailBudget = Math.min(Math.floor(budget * 0.3), 4000);
            const headBudget = Math.max(0, budget - tailBudget - marker.length);
            return `${this.cleanCut(text, headBudget, 'head')}${marker}${this.cleanCut(text.slice(text.length - tailBudget), tailBudget, 'tail')}${notice}`;
        }
        return `${this.cleanCut(text, budget, 'head')}${notice}`;
    }

    private cleanCut(text: string, budget: number, side: 'head' | 'tail'): string {
        if (budget <= 0) return '';
        if (text.length <= budget) return text;
        if (side === 'tail') {
            const tail = text.slice(text.length - budget);
            const newline = tail.indexOf('\n');
            return newline > 0 && newline < budget * 0.2 ? tail.slice(newline + 1) : tail;
        }
        const head = text.slice(0, budget);
        const newline = head.lastIndexOf('\n');
        return newline > budget * 0.8 ? head.slice(0, newline) : head;
    }

    private hasImportantTail(text: string): boolean {
        const tail = text.slice(-2000).toLowerCase();
        return /\b(error|exception|failed|fatal|traceback|panic|stack trace|errno|exit code|summary|result|complete|finished|done)\b/.test(tail)
            || /\}\s*$/.test(tail.trim());
    }

    private isReadFileData(data: unknown): data is { path: string; content: string; startLine: number; endLine: number; totalLines: number; bytes: number; truncated: boolean } {
        return Boolean(data)
            && typeof data === 'object'
            && typeof (data as { path?: unknown }).path === 'string'
            && typeof (data as { bytes?: unknown }).bytes === 'number'
            && typeof (data as { startLine?: unknown }).startLine === 'number'
            && typeof (data as { endLine?: unknown }).endLine === 'number'
            && typeof (data as { totalLines?: unknown }).totalLines === 'number'
            && typeof (data as { truncated?: unknown }).truncated === 'boolean'
            && typeof (data as { content?: unknown }).content === 'string';
    }
}
