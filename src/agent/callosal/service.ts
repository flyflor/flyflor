import { FAgentAtom, Inject, type ToolContext } from '@/core';
import { Intelligence, type AgentMemory } from '@/agent/brain/intelligence';
import { PromptService } from '@/core';
import { ToolRegistry } from '@/tools';
import {
    CALLOSAL_DEFAULT_INVESTIGATION_PROMPT,
    CALLOSAL_DEFAULT_ROUTE_PROMPT,
    CALLOSAL_EVIDENCE_MAX_CHARS,
    CALLOSAL_INVESTIGATION_BUDGET,
    CALLOSAL_INVESTIGATION_BLOCK,
    CALLOSAL_ROUTE_BLOCK,
} from './constants';
import {
    CallosalAction,
    type CallosalBrief,
    type CallosalDecision,
    type CallosalNavigateContext,
    type CallosalTurn,
} from './types';

/**
 * The corpus callosum: the left-right brain scheduler that inspects every turn before it reaches
 * the agent's main reflex or execution loop.
 *
 * `navigate(text, context)` runs four phases in sequence:
 *   1. Soul write — send the turn through the protocol-package constitution to detect and apply
 *      durable updates (identity, user profile, extension summary). A write reply bypasses the rest.
 *   2. Intent scout — one cheap LLM call to decide chat vs execute and suggest read-only evidence calls.
 *   3. Investigate — run the scouted evidence calls, but only against read-only tools (structural
 *      guarantee, not prompt: the registry skips mutating calls by checking `tool.readOnly`).
 *   4. Distill — compress the scout + evidence + original turn into a brief the execution phase
 *      consumes; the original long conversation never crosses the callosal boundary into execution.
 */
export class Callosal extends FAgentAtom {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public promptSvc!: PromptService;

    @Inject()
    public registry!: ToolRegistry;

    public async navigate(text: string, context: CallosalNavigateContext = {}): Promise<CallosalTurn> {
        this.next({ type: 'start', turn: text });

        const soul = await this.runSoulWrite(text);
        if (soul !== undefined) return soul;

        const decision = await this.runScout(text, context.history ?? []);

        if (!decision.needsTools || decision.taskType === 'chat') {
            return { action: CallosalAction.Chat, content: text };
        }

        const evidence = await this.runInvestigation(decision);

        const brief = await this.runDistill(text, decision, evidence);

        return { action: CallosalAction.Execute, content: text, decision, brief };
    }

    /**
     * Phase 1 — Soul write: check the protocol-package constitution for durable updates.
     */
    private async runSoulWrite(text: string): Promise<CallosalTurn | undefined> {
        const block = this.promptSvc.prompts.blocks?.[CALLOSAL_ROUTE_BLOCK];
        if (!block) return undefined;

        const reply = await this.intelligence.complete([
            { role: 'system' as AgentMemory['role'], content: block.body },
            { role: 'user' as AgentMemory['role'], content: text },
        ]);
        const payload = this.registry.extractObject(reply);
        if (!payload) return undefined;

        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(payload); } catch { return undefined; }
        if (!Array.isArray(parsed.writes) || (parsed.writes as unknown[]).length === 0) return undefined;

        const writes: Array<{ file: string; content: string }> = [];
        for (const item of parsed.writes as Array<Record<string, unknown>>) {
            if (typeof item.file === 'string' && typeof item.content === 'string') {
                writes.push({ file: item.file, content: item.content });
            }
        }
        if (writes.length === 0) return undefined;

        const pkg = this.promptSvc.prompts;
        const editable = new Set(pkg.config?.data?.protocolPackage?.editable ?? []);
        for (const write of writes) {
            if (!editable.has(write.file)) continue;
            const key = write.file.replace(/\.md$/, '');
            pkg[key]?.set(write.content);
        }

        const names = writes.map((w) => w.file).join(', ');
        this.next({ type: 'soul', writes: names });
        const content = typeof parsed.reply === 'string' && parsed.reply.length > 0 ? parsed.reply : `Updated: ${names}`;
        return { action: CallosalAction.Reply, content: text, reply: content };
    }

    /**
     * Phase 2 — Intent scout: one cheap LLM call to decide direction and plan evidence calls.
     */
    private async runScout(text: string, history: AgentMemory[]): Promise<CallosalDecision> {
        const block = this.promptSvc.prompts.blocks?.[CALLOSAL_ROUTE_BLOCK];
        const system = block?.body ?? CALLOSAL_DEFAULT_ROUTE_PROMPT;
        const messages: AgentMemory[] = [
            { role: 'system' as AgentMemory['role'], content: system },
            ...history,
            { role: 'user' as AgentMemory['role'], content: text },
        ];
        const reply = await this.intelligence.complete(messages);
        const payload = this.registry.extractObject(reply) ?? '{}';
        const parsed: Record<string, unknown> = (() => { try { return JSON.parse(payload); } catch { return {}; } })();
        return {
            needsTools: parsed.needsTools === true,
            taskType: typeof parsed.taskType === 'string' ? parsed.taskType : 'unknown',
            summary: typeof parsed.summary === 'string' ? parsed.summary : '',
            investigation: Array.isArray(parsed.investigation)
                ? (parsed.investigation as Array<Record<string, unknown>>)
                    .filter((c) => typeof c.name === 'string')
                    .map((c) => ({ name: c.name as string, input: (c.input as Record<string, unknown>) ?? {} }))
                : [],
        };
    }

    /**
     * Phase 3 — Investigate: run the scouted evidence calls, but only against read-only tools.
     * The structural guarantee (registry checks `tool.readOnly`) means this never mutates.
     */
    private async runInvestigation(decision: CallosalDecision): Promise<string[]> {
        const context: ToolContext = { cwd: process.cwd(), reads: new Map() };
        const tools = await this.registry.list();
        const evidence: string[] = [];
        let count = 0;
        for (const call of decision.investigation) {
            if (count >= CALLOSAL_INVESTIGATION_BUDGET) break;
            const tool = tools.find((t) => t.name === call.name);
            if (!tool || !tool.readOnly) continue;
            count += 1;
            const result = await this.registry.dispatch(call, context);
            const clipped = result.result.length > CALLOSAL_EVIDENCE_MAX_CHARS
                ? this.registry.truncate(result.result, CALLOSAL_EVIDENCE_MAX_CHARS)
                : result.result;
            evidence.push(clipped);
        }
        this.next({ type: 'investigate', evidence });
        return evidence;
    }

    /**
     * Phase 4 — Distill: compress scout + evidence + original turn into one execution brief.
     */
    private async runDistill(text: string, decision: CallosalDecision, evidence: string[]): Promise<CallosalBrief> {
        const block = this.promptSvc.prompts.blocks?.[CALLOSAL_INVESTIGATION_BLOCK];
        const system = block?.body ?? CALLOSAL_DEFAULT_INVESTIGATION_PROMPT;
        const scout = JSON.stringify({ summary: decision.summary, taskType: decision.taskType, investigation: decision.investigation.map((c) => c.name) });
        const user = ['Scout:', scout, '', 'Evidence:', evidence.join('\n\n'), '', 'Original turn:', text].join('\n');
        const reply = await this.intelligence.complete([
            { role: 'system' as AgentMemory['role'], content: system },
            { role: 'user' as AgentMemory['role'], content: user },
        ]);
        const payload = this.registry.extractObject(reply) ?? '{}';
        const brief: CallosalBrief = {
            userIntent: decision.summary,
            taskType: decision.taskType,
            needsTools: true,
            relatedFiles: [],
            evidence: [],
            instructions: '',
        };
        try {
            const parsed = JSON.parse(payload);
            if (typeof parsed.userIntent === 'string') brief.userIntent = parsed.userIntent;
            if (typeof parsed.taskType === 'string') brief.taskType = parsed.taskType;
            if (typeof parsed.needsTools === 'boolean') brief.needsTools = parsed.needsTools;
            if (Array.isArray(parsed.relatedFiles)) brief.relatedFiles = parsed.relatedFiles.filter((f: unknown) => typeof f === 'string');
            if (Array.isArray(parsed.evidence)) brief.evidence = parsed.evidence.filter((e: unknown) => typeof e === 'string');
            if (typeof parsed.instructions === 'string') brief.instructions = parsed.instructions;
        } catch { /* keep the fallback brief */ }
        this.next({ type: 'distill', brief });
        return brief;
    }
}
