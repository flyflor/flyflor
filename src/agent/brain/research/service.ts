import { FAgentAtom, Inject, Provide, RuntimeText } from '@/core';
import { Intelligence } from '../intelligence/service';
import { ToolRegistry } from './tool.registry';
import { AgentChatRole, type AgentMemory, type AgentToolCall } from '@/agent/memory';
import { type ResearchOutcome, type ResearchToolPreview } from './types';
import type { IntelligenceToolDefinition } from '../intelligence/types';

const RESEARCH_SYSTEM_TEXT_KEY = 'research.system.brief';

/**
 * One signal surfaced while research runs.
 * The loop streams `reply` text live and announces each tool call so the Brain can forward UI events without
 * knowing the loop's internals.
 */
export type ResearchSignal =
    | { type: 'reply'; chunk: string }
    | { type: 'llm_turn'; step: number; text: string; stopReason: string; toolCalls: string[] }
    | { type: 'tool_start'; name: string; arguments: Record<string, unknown> }
    | { type: 'tool_result'; name: string; content: string; isError: boolean; preview: ResearchToolPreview };

/**
 * A pre-execution permission gate.
 * Returns a block decision to veto a tool call before it runs; returning `undefined` allows it. This is the
 * defense-in-depth seam (pi's `beforeToolCall`): isolated investigations use it to refuse anything but reads.
 */
export type ResearchGate = (name: string, args: Record<string, unknown>) => { block: true; reason: string } | undefined;

/**
 * Per-run overrides for the research loop.
 * `tools` replaces the advertised tool set (an isolated investigation narrows it to read-only); `gate` vetoes
 * individual calls even when a tool is advertised.
 */
export interface ResearchRunOptions {
    tools?: IntelligenceToolDefinition[];
    gate?: ResearchGate;
    workingDirectory?: string;
    toolRoots?: string[];
}

/**
 * The research loop: native function-calling investigation (intent → tools → evidence → answer).
 *
 * It streams an assistant response, runs any requested read-only tools, feeds the results back, and repeats
 * until the model stops requesting tools. The loop owns no routing or persistence —
 * the Brain assembles its input messages and forwards its signals.
 */
@Provide()
export class Research extends FAgentAtom {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public registry!: ToolRegistry;

    @Inject()
    public runtimeText!: RuntimeText;

    /**
     * Runs the investigation to a final answer.
     * `messages` is the assembled turn input; `emit` forwards streamed reply text and tool lifecycle signals;
     * `options` can narrow the tool set and add a permission gate (used by isolated deep investigation).
     */
    public async run(messages: AgentMemory[], emit: (signal: ResearchSignal) => void, options: ResearchRunOptions = {}): Promise<ResearchOutcome> {
        this.registry.resetArtifacts();
        const working: AgentMemory[] = this.withResearchSystem(messages);
        const exchange: AgentMemory[] = [];
        const tools = options.tools ?? this.registry.definitions();
        let answer = '';
        for (let step = 1; ; step += 1) {
            this.log.debug('research.turn', step);
            const turn = await this.intelligence.runTurn(working, tools);
            answer = turn.text;
            emit({
                type: 'llm_turn',
                step,
                text: turn.text,
                stopReason: turn.stopReason,
                toolCalls: turn.toolCalls.map((toolCall) => toolCall.name),
            });
            if (turn.toolCalls.length === 0 && turn.text.length > 0) {
                emit({ type: 'reply', chunk: turn.text });
            }
            if (turn.toolCalls.length === 0) {
                return { answer, exchange, steps: step };
            }
            // The assistant tool-call turn and its results are part of the durable evidence trail, but the
            // final pure-text answer is committed by the Agent, so it is never pushed into `exchange`.
            const assistant: AgentMemory = { role: AgentChatRole.Assistant, content: turn.text, toolCalls: turn.toolCalls, reasoning: turn.reasoning };
            working.push(assistant);
            exchange.push(assistant);
            const results = await this.runTools(turn.toolCalls, step, emit, options);
            working.push(...results);
            exchange.push(...results);
        }
    }

    private withResearchSystem(messages: AgentMemory[]): AgentMemory[] {
        const brief: AgentMemory = { role: AgentChatRole.System, content: this.runtimeText.text(RESEARCH_SYSTEM_TEXT_KEY) };
        const insertAt = messages.findIndex((message) => message.role !== AgentChatRole.System);
        if (insertAt < 0) return [...messages, brief];
        return [...messages.slice(0, insertAt), brief, ...messages.slice(insertAt)];
    }

    /**
     * Runs one assistant turn's tool calls in parallel and returns their result messages in source order.
     * Order is preserved so the tool results line up with the assistant tool calls on the next provider call.
     */
    private async runTools(toolCalls: AgentToolCall[], step: number, emit: (signal: ResearchSignal) => void, options: ResearchRunOptions): Promise<AgentMemory[]> {
        const results = await Promise.all(toolCalls.map((toolCall) => this.runTool(toolCall, step, emit, options)));
        return results.map((result) => ({ role: AgentChatRole.Tool, content: result.content, toolCallId: result.id, toolName: result.name, isError: result.isError }));
    }

    /**
     * Runs one tool call, emitting its start and result signals.
     * A `gate` veto short-circuits execution with an error result, so a blocked tool is surfaced to the model
     * but never runs.
     */
    private async runTool(toolCall: AgentToolCall, step: number, emit: (signal: ResearchSignal) => void, options: ResearchRunOptions): Promise<{ id: string; name: string; content: string; isError: boolean }> {
        emit({ type: 'tool_start', name: toolCall.name, arguments: toolCall.arguments });
        const blocked = options.gate?.(toolCall.name, toolCall.arguments);
        const outcome =
            blocked !== undefined
                ? this.registry.blocked(toolCall.name, blocked.reason, {
                      callId: toolCall.id,
                      intent: toolCall.name,
                      evidenceCount: step,
                      workingDirectory: options.workingDirectory,
                      toolRoots: options.toolRoots,
                  })
                : await this.registry.dispatch(toolCall.name, toolCall.arguments, {
                      callId: toolCall.id,
                      intent: toolCall.name,
                      evidenceCount: step,
                      workingDirectory: options.workingDirectory,
                      toolRoots: options.toolRoots,
                  });
        emit({ type: 'tool_result', name: toolCall.name, content: outcome.preview.preview, isError: outcome.isError, preview: outcome.preview });
        return { id: toolCall.id, name: toolCall.name, content: outcome.content, isError: outcome.isError };
    }
}
