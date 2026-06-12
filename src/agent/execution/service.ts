import { FAgentAtom, Inject, type ToolContext } from '@/core';
import { Intelligence, type AgentMemory } from '@/agent/brain/intelligence';
import { Memory } from '@/agent/memory';
import { ToolRegistry, type ToolCall } from '@/tools';
import {
    EXECUTION_DEFAULT_PROMPT,
    EXECUTION_MAX_ITERATIONS,
    EXECUTION_PARSE_RETRY_LIMIT,
} from './constants';
import type { ExecutionResult, ExecutionReason } from './types';

/**
 * The motor cortex: owns the sample→parse→dispatch→feedback loop that turns the distilled
 * callosal brief into computer actions.
 *
 * `run()` is the single entry: it assembles the execution context (soul + execution protocol +
 * tool catalog + environment + brief), then loops until the model returns `{"type":"final"}` or
 * a guard fires. Every exit is typed; every tool error stays in-band for the model to recover from.
 */
export class Execution extends FAgentAtom {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public memory!: Memory;

    @Inject()
    public registry!: ToolRegistry;

    /**
     * Runs one execution loop and returns the typed result.
     *
     * @param brief The distilled callosal brief — the only narrative the execution phase sees.
     * @param history Optional preamble messages (soul sections + environment already prepended
     * by the caller; the loop re-prepends them every iteration so the prompt cache is stable).
     */
    public async run(brief: string, history: AgentMemory[]): Promise<ExecutionResult> {
        this.next({ type: 'start', brief });
        const context: ToolContext = { cwd: process.cwd(), reads: new Map() };
        const toolCalls: ExecutionResult['toolCalls'] = [];
        let parseFailures = 0;

        const toolCatalog = await this.registry.render();
        const system = `${history.map((m) => m.content).join('\n\n')}\n\n${EXECUTION_DEFAULT_PROMPT}\n\nAvailable tools:\n${toolCatalog}`;
        const nextMessage = (content: string): AgentMemory[] => [
            { role: 'system' as AgentMemory['role'], content: system },
            { role: 'user' as AgentMemory['role'], content: brief },
            { role: 'assistant' as AgentMemory['role'], content: content },
        ];

        let lastContent = '';

        for (let iteration = 0; iteration < EXECUTION_MAX_ITERATIONS; iteration += 1) {
            const messages = iteration === 0
                ? [{ role: 'system' as AgentMemory['role'], content: system }, { role: 'user' as AgentMemory['role'], content: brief }]
                : nextMessage(lastContent);

            this.next({ type: 'sample', messages });
            const reply = await this.intelligence.complete(messages);
            const parsed = this.registry.parse(reply);

            this.next({ type: 'parse', message: parsed });

            if (parsed.type === 'final') {
                return { ok: true, text: parsed.text, reason: 'final', toolCalls };
            }

            if (parsed.type === 'invalid') {
                parseFailures += 1;
                if (parseFailures > EXECUTION_PARSE_RETRY_LIMIT) {
                    return { ok: false, text: reply, reason: 'parse-failure', toolCalls };
                }
                lastContent = `${reply}\n\n[Parsing this reply failed: ${parsed.reason}. Use ONLY the compact JSON format: {"type":"final","text":"..."} or {"type":"tool","calls":[...]} without markdown fences or free text.]`;
                continue;
            }

            parseFailures = 0;

            // parsed.type === 'tool'
            this.next({ type: 'tool', calls: parsed.calls });
            const results: string[] = [];
            for (const call of parsed.calls) {
                const record = await this.registry.dispatch(call, context);
                this.next({ type: 'result', record });
                toolCalls.push({ name: record.name, input: record.input, ok: record.ok, result: record.result });
                results.push(JSON.stringify(record));

                if (!record.ok) continue;
                const tool = await this.registry.find(call.name);
                if (tool?.terminal) {
                    const reason: ExecutionReason = call.name === 'ask' ? 'ask' : call.name === 'confirm' ? 'confirm' : 'final';
                    return { ok: true, text: record.result, reason, toolCalls };
                }
            }
            lastContent = results.join('\n');
        }

        return {
            ok: false,
            text: `Execution reached the iteration limit (${EXECUTION_MAX_ITERATIONS} tool-use turns). Work done so far:\n${JSON.stringify(toolCalls.map((c) => ({ name: c.name, ok: c.ok })))}`,
            reason: 'max-iterations',
            toolCalls,
        };
    }
}
