import { FService, FTool, Singleton, useContainer, type ToolContext } from '@/core';
import { TOOL_BLOCK_CLOSE_TAG, TOOL_BLOCK_OPEN_TAG, TOOL_RESULT_CLIPPED_NOTICE, TOOL_RESULT_HEAD_RATIO } from './constants';
import type { ToolCall, ToolProtocolMessage, ToolResult } from './types';

/**
 * The tool registry: the single choke point between "the model requested a call" and "a tool ran".
 *
 * Discovery is structural — `listModule(FTool)` walks every class imported through `ToolsModule`, so
 * importing a tool class is the entire registration act (convention over configuration). The registry
 * owns the execution protocol surface: rendering the model-visible tool list, parsing one model reply
 * into a typed protocol message, and dispatching calls. Every executor exception is converted into an
 * in-band error result the model can recover from; nothing here throws across the loop boundary.
 */
@Singleton()
export class ToolRegistry extends FService {
    /**
     * Lists every discovered tool instance in deterministic name order.
     * Stable ordering keeps the rendered prompt prefix cache-friendly across turns.
     */
    public async list(): Promise<FTool[]> {
        const container = useContainer();
        const tools: FTool[] = [];
        for (const classType of container.listModule(FTool)) {
            tools.push(await container.getAsync(classType));
        }
        return tools.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Finds one tool by its stable name.
     */
    public async find(name: string): Promise<FTool | undefined> {
        const tools = await this.list();
        return tools.find((tool) => tool.name === name);
    }

    /**
     * Renders the model-visible tool catalog for the execution system prompt.
     */
    public async render(): Promise<string> {
        const tools = await this.list();
        const lines = tools.map((tool) => {
            const traits: string[] = [];
            if (tool.readOnly) traits.push('read-only');
            if (tool.terminal) traits.push('terminal');
            const suffix = traits.length > 0 ? ` (${traits.join(', ')})` : '';
            return `- ${tool.name}${suffix}: ${tool.description}\n  parameters: ${JSON.stringify(tool.parameters)}`;
        });
        return lines.join('\n');
    }

    /**
     * Parses one model reply into a typed protocol message.
     *
     * Accepted shapes, in priority order: `<flyflor:tool>{...}</flyflor:tool>` control blocks (one call
     * per block), a JSON object `{"type":"final"|"tool",...}` (markdown fences tolerated), or plain
     * prose with no JSON at all — which is the model simply answering, i.e. a natural `final`.
     * A reply that *attempts* JSON but is malformed becomes `invalid` so the loop can feed back a
     * correction instead of guessing.
     */
    public parse(text: string): ToolProtocolMessage {
        const blocks = this.parseToolBlocks(text);
        if (blocks !== undefined) return blocks;

        const payload = this.extractObject(text);
        if (payload === undefined) {
            const trimmed = text.trim();
            if (trimmed.length === 0) return { type: 'invalid', reason: 'Empty reply. Return a {"type":"final"|"tool"} JSON object.' };
            // A reply that opens a brace but never balances it is a truncated JSON attempt, not prose.
            if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
                return { type: 'invalid', reason: 'Reply started JSON but the object never closed. Return one complete JSON object.' };
            }
            return { type: 'final', text: trimmed };
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(payload);
        } catch (error) {
            return { type: 'invalid', reason: `Reply looked like JSON but failed to parse: ${error instanceof Error ? error.message : String(error)}` };
        }
        return this.classifyMessage(parsed);
    }

    /**
     * Dispatches one tool call and returns its recorded result.
     *
     * Unknown names, input contract violations, and executor exceptions all come back as `ok: false`
     * results addressed to the model — the two-tier error contract keeps recoverable failures in-band.
     * Successful results are truncated here, at record time, against the tool's own budget.
     */
    public async dispatch(call: ToolCall, context: ToolContext): Promise<ToolResult> {
        const tool = await this.find(call.name);
        if (!tool) {
            const names = (await this.list()).map((item) => item.name).join(', ');
            return { name: call.name, input: call.input, ok: false, result: `Unknown tool '${call.name}'. Available tools: ${names}` };
        }
        try {
            this.log.debug('tool.dispatch', call.name, call.input);
            const result = await tool.execute(call.input, context);
            return { name: call.name, input: call.input, ok: true, result: this.truncate(result, tool.maxResultChars) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const detail = (error as { detail?: unknown })?.detail;
            this.log.debug('tool.error', call.name, message);
            return {
                name: call.name,
                input: call.input,
                ok: false,
                result: detail === undefined ? message : `${message} ${JSON.stringify(detail)}`,
            };
        }
    }

    /**
     * Clips one result to a per-tool budget, keeping head and tail around an explicit notice.
     * Truncation happens once, when the result is recorded — never when it is read back.
     */
    public truncate(result: string, maxChars: number): string {
        if (result.length <= maxChars) return result;
        const headBudget = Math.floor(maxChars * TOOL_RESULT_HEAD_RATIO);
        const tailBudget = maxChars - headBudget;
        const head = result.slice(0, headBudget);
        const tail = result.slice(result.length - tailBudget);
        return `${head}\n${TOOL_RESULT_CLIPPED_NOTICE}\n${tail}`;
    }

    /**
     * Parses every `<flyflor:tool>` control block in a reply into one tool batch.
     * @returns The tool message, an `invalid` correction when a block is malformed, or `undefined`
     * when the reply contains no control block at all.
     */
    private parseToolBlocks(text: string): ToolProtocolMessage | undefined {
        if (!text.includes(TOOL_BLOCK_OPEN_TAG)) return undefined;
        const calls: ToolCall[] = [];
        let cursor = 0;
        while (true) {
            const open = text.indexOf(TOOL_BLOCK_OPEN_TAG, cursor);
            if (open === -1) break;
            const close = text.indexOf(TOOL_BLOCK_CLOSE_TAG, open + TOOL_BLOCK_OPEN_TAG.length);
            if (close === -1) return { type: 'invalid', reason: `A ${TOOL_BLOCK_OPEN_TAG} block is missing its closing tag.` };
            const body = text.slice(open + TOOL_BLOCK_OPEN_TAG.length, close).trim();
            let parsed: unknown;
            try {
                parsed = JSON.parse(body);
            } catch (error) {
                return { type: 'invalid', reason: `A ${TOOL_BLOCK_OPEN_TAG} block is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
            }
            const callMessage = this.classifyCall(parsed);
            if (callMessage === undefined) return { type: 'invalid', reason: `A ${TOOL_BLOCK_OPEN_TAG} block must contain {"name": string, "input": object}.` };
            calls.push(callMessage);
            cursor = close + TOOL_BLOCK_CLOSE_TAG.length;
        }
        return { type: 'tool', calls };
    }

    /**
     * Classifies a parsed JSON payload into the final/tool protocol contract.
     */
    private classifyMessage(parsed: unknown): ToolProtocolMessage {
        if (typeof parsed !== 'object' || parsed === null) {
            return { type: 'invalid', reason: 'Reply JSON must be an object with a "type" field.' };
        }
        const message = parsed as Record<string, unknown>;
        if (message.type === 'final' && typeof message.text === 'string') {
            return { type: 'final', text: message.text };
        }
        if (message.type === 'tool' && Array.isArray(message.calls)) {
            const calls: ToolCall[] = [];
            for (const item of message.calls) {
                const call = this.classifyCall(item);
                if (call === undefined) return { type: 'invalid', reason: 'Each entry of "calls" must be {"name": string, "input": object}.' };
                calls.push(call);
            }
            return { type: 'tool', calls };
        }
        return { type: 'invalid', reason: 'Reply JSON must be {"type":"final","text":string} or {"type":"tool","calls":[...]}.' };
    }

    /**
     * Validates one raw call payload into a typed `ToolCall`.
     */
    private classifyCall(parsed: unknown): ToolCall | undefined {
        if (typeof parsed !== 'object' || parsed === null) return undefined;
        const call = parsed as Record<string, unknown>;
        if (typeof call.name !== 'string' || call.name.length === 0) return undefined;
        const input = call.input;
        if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) return undefined;
        return { name: call.name, input: (input as Record<string, unknown>) ?? {} };
    }

    /**
     * Extracts the first balanced JSON object from a reply, tolerating markdown fences and prose
     * around it. String literals and escapes are respected during brace balancing. Public because
     * the callosal reuses the same tolerance when reading its scout/distill JSON replies.
     */
    public extractObject(text: string): string | undefined {
        const start = text.indexOf('{');
        if (start === -1) return undefined;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < text.length; index += 1) {
            const char = text[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }
            if (char === '"') {
                inString = true;
                continue;
            }
            if (char === '{') depth += 1;
            if (char === '}') {
                depth -= 1;
                if (depth === 0) return text.slice(start, index + 1);
            }
        }
        return undefined;
    }
}
