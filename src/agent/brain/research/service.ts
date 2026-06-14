import { FAgentAtom, Inject, Logger, Prompt, PromptService, Provide, Scope, type FLogger, type ToolExecutionContext } from '@/core';
import { AgentChatRole, Memory, type AgentMemory } from '@/agent/memory';
import type { AgentTurnContext } from '@/agent/types';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { CallosumSignalType, type CallosumSignal } from '@/agent/brain/callosum';
import { AskTool, CodeGraphTool, ConfirmTool, ReadFileTool, ToolBoundary } from '@/plugins';
import {
    ResearchStopReason,
    type ResearchClarificationRequest,
    type ResearchEvidence,
    type ResearchPlan,
    type ResearchRunResult,
} from './types';

export enum ResearchPrompt {
    Research = 'RESEARCH',
}

@Provide()
export class Research extends FAgentAtom<CallosumSignal> {
    @Inject()
    public intelligence!: Intelligence;

    @Scope()
    public memory!: Memory;

    @Inject()
    public ask!: AskTool;

    @Inject()
    public confirm!: ConfirmTool;

    @Inject()
    public readFile!: ReadFileTool;

    @Inject()
    public codegraph!: CodeGraphTool;

    @Inject()
    public boundary!: ToolBoundary;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<ResearchPrompt>;

    @Logger(Research.name)
    public readonly log!: FLogger;

    public async run(messages: AgentMemory[], latestUserContent: string, context: AgentTurnContext = {}): Promise<ResearchRunResult> {
        const pending = this.memory.pendingResearch;
        const originalUserContent = pending?.originalUserContent ?? latestUserContent;
        const clarification = pending === undefined ? '' : latestUserContent;
        let summary = pending?.summary ?? '';
        const evidence = [...(pending?.evidence ?? [])];
        const clarificationRequest = pending?.clarification;
        const workingDirectory = pending?.workingDirectory ?? context.workingDirectory;
        let lastTurn = 0;

        this.log.info('research.start', {
            pending: pending !== undefined,
            awaiting: pending?.awaiting,
            originalUserContent,
            clarification: clarification.length === 0 ? undefined : clarification,
            summary: summary.length === 0 ? undefined : summary,
            evidenceCount: evidence.length,
            evidence: this.evidenceSnapshot(evidence),
            clarificationRequest,
            workingDirectory,
        });

        for (let turn = 0; turn < 6; turn += 1) {
            lastTurn = turn;
            this.log.debug('research.turn.state', {
                turn,
                summary: summary.length === 0 ? undefined : summary,
                evidenceCount: evidence.length,
                evidence: this.evidenceSnapshot(evidence),
                clarificationRequest,
                workingDirectory,
            });

            const plan = await this.plan(turn, messages, originalUserContent, clarification, summary, evidence, clarificationRequest, workingDirectory);
            summary = plan.summary;
            this.emitResearchSummary(turn, summary, evidence.length, pending !== undefined);
            this.log.info('research.turn.plan', {
                turn,
                action: plan.action,
                summary: plan.summary,
                evidenceCount: evidence.length,
            });

            if (plan.action === 'ask') {
                this.log.info('research.ask', {
                    turn,
                    question: plan.question,
                    options: plan.options,
                    summary: plan.summary,
                });
                const result = await this.ask.execute({ question: plan.question, options: plan.options }, this.toolContext('ask', summary, evidence.length));
                if (!result.ok) throw Error(result.error);
                this.memory.pendingResearch = {
                    originalUserContent,
                    summary,
                    evidence,
                    clarification: result.data,
                    awaiting: 'ask',
                    workingDirectory,
                };
                this.log.info('research.pending', {
                    turn,
                    awaiting: 'ask',
                    question: result.data.question,
                    summary,
                    evidenceCount: evidence.length,
                });
                this.emit({ type: CallosumSignalType.Clarification, chunk: result.data.question, data: result.data });
                return { reason: ResearchStopReason.NeedsUser };
            }

            if (plan.action === 'confirm') {
                this.log.info('research.confirm', {
                    turn,
                    question: plan.question,
                    recommended: plan.recommended,
                    summary: plan.summary,
                });
                const result = await this.confirm.execute({ question: plan.question, recommended: plan.recommended }, this.toolContext('confirm', summary, evidence.length));
                if (!result.ok) throw Error(result.error);
                this.memory.pendingResearch = {
                    originalUserContent,
                    summary,
                    evidence,
                    clarification: result.data,
                    awaiting: 'confirm',
                    workingDirectory,
                };
                this.log.info('research.pending', {
                    turn,
                    awaiting: 'confirm',
                    question: result.data.question,
                    summary,
                    evidenceCount: evidence.length,
                });
                this.emit({ type: CallosumSignalType.Clarification, chunk: result.data.question, data: result.data });
                return { reason: ResearchStopReason.NeedsUser };
            }

            if (plan.action === 'search') {
                evidence.push(await this.search(turn, plan, summary, evidence.length, workingDirectory));
                continue;
            }

            if (plan.action === 'read') {
                evidence.push(await this.read(turn, plan, summary, evidence.length, workingDirectory));
                continue;
            }

            this.log.info('research.synthesize', {
                turn,
                summary: plan.summary,
                answerPlan: plan.answerPlan,
                evidenceCount: evidence.length,
            });
            this.memory.pendingResearch = undefined;
            if (clarification.length > 0) {
                this.log.debug('research.commit_user', {
                    turn,
                    originalUserContent,
                    clarification,
                });
                this.memory.useCommitUser(`${originalUserContent}\n\nClarification:\n${clarification}`);
            }
            await this.answer(turn, originalUserContent, clarification, evidence, plan.answerPlan, workingDirectory);
            return { reason: ResearchStopReason.Answered };
        }

        this.log.warn('research.max_turns', {
            summary,
            evidenceCount: evidence.length,
            evidence: this.evidenceSnapshot(evidence),
        });
        this.memory.pendingResearch = undefined;
        await this.answer(lastTurn, originalUserContent, clarification, evidence, 'The research loop reached its maximum planning turns; answer from the available evidence and state any uncertainty.', workingDirectory);
        return { reason: ResearchStopReason.MaxTurns };
    }

    private async plan(
        turn: number,
        messages: AgentMemory[],
        originalUserContent: string,
        clarification: string,
        summary: string,
        evidence: ResearchEvidence[],
        clarificationRequest?: ResearchClarificationRequest,
        workingDirectory?: string,
    ): Promise<ResearchPlan> {
        this.log.debug('research.plan.request', {
            turn,
            originalUserContent,
            clarification: clarification.length === 0 ? undefined : clarification,
            summary: summary.length === 0 ? undefined : summary,
            evidenceCount: evidence.length,
            evidence: this.evidenceSnapshot(evidence),
            clarificationRequest,
            workingDirectory,
        });
        const content = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data.RESEARCH?.data) },
            { role: AgentChatRole.System, content: this.toolManifest() },
            { role: AgentChatRole.System, content: this.researchState(originalUserContent, clarification, summary, evidence, clarificationRequest, workingDirectory) },
            ...messages,
        ]);
        this.log.debug('research.plan.raw', {
            turn,
            content,
        });
        const plan = this.parsePlan(content);
        this.log.info('research.plan.decoded', {
            turn,
            action: plan.action,
            summary: plan.summary,
        });
        return plan;
    }

    private async search(turn: number, plan: Extract<ResearchPlan, { action: 'search' }>, summary: string, evidenceCount: number, workingDirectory?: string): Promise<ResearchEvidence> {
        const id = this.toolId('codegraph', evidenceCount);
        const input = { query: plan.query, roots: plan.roots, maxResults: plan.maxResults };
        const context = this.toolContext(id, summary, evidenceCount, workingDirectory);
        const boundary = this.boundarySnapshot(plan.roots ?? ['.'], context);
        this.log.info('research.tool.start', { turn, id, name: 'codegraph', input, summary, evidenceCount, context, boundary });
        this.emit({ type: CallosumSignalType.ToolStart, chunk: '', data: { id, name: 'codegraph', input } });
        const result = await this.executeTool(turn, id, 'codegraph', context, boundary, () => this.codegraph.execute(input, context));
        this.log.info('research.tool.result', {
            turn,
            id,
            name: 'codegraph',
            ok: result.ok,
            data: result.ok ? this.toolResultSnapshot('codegraph', result.data) : undefined,
            error: result.ok ? undefined : result.error,
        });
        this.emit({ type: CallosumSignalType.ToolResult, chunk: '', data: { id, name: 'codegraph', ok: result.ok, data: result.ok ? result.data : undefined, error: result.ok ? undefined : result.error } });
        if (!result.ok) throw Error(result.error);
        return {
            id,
            tool: 'codegraph',
            summary: `Search "${plan.query}" returned ${result.data.matches.length} matches.`,
            data: result.data,
        };
    }

    private async read(turn: number, plan: Extract<ResearchPlan, { action: 'read' }>, summary: string, evidenceCount: number, workingDirectory?: string): Promise<ResearchEvidence> {
        const id = this.toolId('read_file', evidenceCount);
        const input = { path: plan.path, maxBytes: plan.maxBytes };
        const context = this.toolContext(id, summary, evidenceCount, workingDirectory);
        const boundary = this.boundarySnapshot([plan.path], context);
        this.log.info('research.tool.start', { turn, id, name: 'read_file', input, summary, evidenceCount, context, boundary });
        this.emit({ type: CallosumSignalType.ToolStart, chunk: '', data: { id, name: 'read_file', input } });
        const result = await this.executeTool(turn, id, 'read_file', context, boundary, () => this.readFile.execute(input, context));
        this.log.info('research.tool.result', {
            turn,
            id,
            name: 'read_file',
            ok: result.ok,
            data: result.ok ? this.toolResultSnapshot('read_file', result.data) : undefined,
            error: result.ok ? undefined : result.error,
        });
        this.emit({ type: CallosumSignalType.ToolResult, chunk: '', data: { id, name: 'read_file', ok: result.ok, data: result.ok ? result.data : undefined, error: result.ok ? undefined : result.error } });
        if (!result.ok) throw Error(result.error);
        return {
            id,
            tool: 'read_file',
            summary: `Read ${result.data.path}${result.data.truncated ? ' (truncated)' : ''}.`,
            data: result.data,
        };
    }

    private async answer(turn: number, originalUserContent: string, clarification: string, evidence: ResearchEvidence[], answerPlan?: string, workingDirectory?: string): Promise<void> {
        this.log.info('research.answer.start', {
            turn,
            answerPlan,
            evidenceCount: evidence.length,
            evidence: this.evidenceSnapshot(evidence),
            workingDirectory,
        });
        const userContent = clarification.length === 0
            ? originalUserContent
            : `${originalUserContent}\n\nUser clarification:\n${clarification}`;
        const base = this.memory.buildMessage(userContent);
        const user = base.at(-1);
        if (user === undefined) throw Error('Research answer message is missing user content');
        const messages = [
            ...base.slice(0, -1),
            { role: AgentChatRole.System, content: this.answerContext(evidence, answerPlan) },
            user,
        ];
        await this.intelligence.stream(messages, (chunk) => {
            this.emit({ type: CallosumSignalType.Reply, chunk });
        });
        this.log.info('research.answer.done', { turn });
    }

    private parsePlan(content: string): ResearchPlan {
        const plan = JSON.parse(content.trim()) as unknown;
        if (typeof plan !== 'object' || plan === null) {
            throw Object.assign(Error('Invalid research plan'), { detail: { plan } });
        }
        const action = (plan as { action?: unknown }).action;
        const summary = (plan as { summary?: unknown }).summary;
        if (typeof action !== 'string' || typeof summary !== 'string' || summary.trim().length === 0) {
            throw Object.assign(Error('Invalid research plan'), { detail: { plan } });
        }
        if (action === 'ask') return this.parseAskPlan(plan, summary);
        if (action === 'confirm') return this.parseConfirmPlan(plan, summary);
        if (action === 'search') return this.parseSearchPlan(plan, summary);
        if (action === 'read') return this.parseReadPlan(plan, summary);
        if (action === 'synthesize') {
            const answerPlan = (plan as { answerPlan?: unknown }).answerPlan;
            return { action, summary, answerPlan: typeof answerPlan === 'string' ? answerPlan : undefined };
        }
        throw Object.assign(Error('Unknown research action'), { detail: { plan } });
    }

    private parseAskPlan(plan: unknown, summary: string): ResearchPlan {
        const root = plan as { question?: unknown; options?: unknown };
        if (typeof root.question !== 'string' || !Array.isArray(root.options)) {
            throw Object.assign(Error('Invalid ask research plan'), { detail: { plan } });
        }
        const options = root.options.map((option) => {
            const item = option as { id?: unknown; label?: unknown; description?: unknown; recommended?: unknown };
            if (typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.description !== 'string' || typeof item.recommended !== 'boolean') {
                throw Object.assign(Error('Invalid ask option'), { detail: { option } });
            }
            return { id: item.id, label: item.label, description: item.description, recommended: item.recommended };
        });
        return { action: 'ask', summary, question: root.question, options };
    }

    private parseConfirmPlan(plan: unknown, summary: string): ResearchPlan {
        const root = plan as { question?: unknown; recommended?: unknown };
        if (typeof root.question !== 'string' || typeof root.recommended !== 'boolean') {
            throw Object.assign(Error('Invalid confirm research plan'), { detail: { plan } });
        }
        return { action: 'confirm', summary, question: root.question, recommended: root.recommended };
    }

    private parseSearchPlan(plan: unknown, summary: string): ResearchPlan {
        const root = plan as { query?: unknown; roots?: unknown; maxResults?: unknown };
        if (typeof root.query !== 'string') {
            throw Object.assign(Error('Invalid search research plan'), { detail: { plan } });
        }
        return {
            action: 'search',
            summary,
            query: root.query,
            roots: Array.isArray(root.roots) ? root.roots.filter((item): item is string => typeof item === 'string') : undefined,
            maxResults: typeof root.maxResults === 'number' ? root.maxResults : undefined,
        };
    }

    private parseReadPlan(plan: unknown, summary: string): ResearchPlan {
        const root = plan as { path?: unknown; maxBytes?: unknown };
        if (typeof root.path !== 'string') {
            throw Object.assign(Error('Invalid read research plan'), { detail: { plan } });
        }
        return {
            action: 'read',
            summary,
            path: root.path,
            maxBytes: typeof root.maxBytes === 'number' ? root.maxBytes : undefined,
        };
    }

    private emitResearchSummary(turn: number, summary: string, evidenceCount: number, pending: boolean): void {
        this.log.info('research.summary', {
            turn,
            summary,
            evidenceCount,
            pending,
        });
        this.emit({
            type: CallosumSignalType.ResearchSummary,
            chunk: summary,
            data: { summary, evidenceCount, pending },
        });
    }

    private toolManifest(): string {
        return [
            '<research_tools>',
            JSON.stringify([
                this.toolDescription(this.ask),
                this.toolDescription(this.confirm),
                this.toolDescription(this.codegraph),
                this.toolDescription(this.readFile),
            ], null, 2),
            '</research_tools>',
        ].join('\n');
    }

    private toolDescription(tool: AskTool | ConfirmTool | CodeGraphTool | ReadFileTool): object {
        return {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        };
    }

    private researchState(
        originalUserContent: string,
        clarification: string,
        summary: string,
        evidence: ResearchEvidence[],
        clarificationRequest?: ResearchClarificationRequest,
        workingDirectory?: string,
    ): string {
        return [
            '<research_state>',
            JSON.stringify({
                originalUserContent,
                workingDirectory,
                clarification: clarification.length === 0 ? undefined : clarification,
                summary: summary.length === 0 ? undefined : summary,
                evidence,
                clarificationRequest,
            }, null, 2),
            '</research_state>',
        ].join('\n');
    }

    private answerContext(evidence: ResearchEvidence[], answerPlan?: string): string {
        return [
            'You are answering after Flyflor research tools ran.',
            'Use the evidence below. Separate facts from inferences and state uncertainty when evidence is incomplete.',
            answerPlan === undefined ? '' : `Answer plan: ${answerPlan}`,
            '<evidence>',
            JSON.stringify(evidence, null, 2),
            '</evidence>',
        ].filter((line) => line.length > 0).join('\n');
    }

    private async executeTool<TData>(
        turn: number,
        id: string,
        name: string,
        context: ToolExecutionContext,
        boundary: unknown,
        execute: () => Promise<{ ok: true; data: TData } | { ok: false; error: string }>,
    ): Promise<{ ok: true; data: TData } | { ok: false; error: string }> {
        try {
            const result = await execute();
            if (!result.ok) {
                this.emitToolError(turn, id, name, result.error, undefined, context, boundary);
            }
            return result;
        } catch (error) {
            const cause = error instanceof Error ? error : Error(String(error));
            this.emitToolError(turn, id, name, cause.message, cause, context, boundary);
            throw cause;
        }
    }

    private emitToolError(turn: number, id: string, name: string, error: string, cause: Error | undefined, context: ToolExecutionContext, boundary: unknown): void {
        const data = {
            id,
            name,
            ok: false,
            error,
            detail: cause === undefined ? undefined : (cause as { detail?: unknown }).detail,
            context,
            boundary,
        };
        this.log.error('research.tool.result', { turn, ...data });
        this.emit({ type: CallosumSignalType.ToolResult, chunk: '', data });
    }

    private boundarySnapshot(paths: string[], context: ToolExecutionContext): unknown {
        try {
            return {
                workingDirectory: context.workingDirectory,
                roots: this.boundary.allowedRoots(context),
                paths: paths.map((path) => this.boundary.describe(path, context)),
            };
        } catch (error) {
            const cause = error instanceof Error ? error : Error(String(error));
            return {
                workingDirectory: context.workingDirectory,
                error: cause.message,
                detail: (cause as { detail?: unknown }).detail,
            };
        }
    }

    private toolContext(callId: string, intent: string, evidenceCount: number, workingDirectory?: string): ToolExecutionContext {
        return { callId, intent, evidenceCount, workingDirectory };
    }

    private toolId(name: string, evidenceCount: number): string {
        return `${name}-${evidenceCount + 1}`;
    }

    private evidenceSnapshot(evidence: ResearchEvidence[]): Array<{ id: string; tool: string; summary: string }> {
        return evidence.map(({ id, tool, summary }) => ({ id, tool, summary }));
    }

    private toolResultSnapshot(tool: string, data: unknown): unknown {
        if (tool === 'codegraph') {
            const result = data as { query?: unknown; matches?: unknown };
            const matches = Array.isArray(result.matches) ? result.matches : [];
            return {
                query: result.query,
                matchCount: matches.length,
                matches: matches.slice(0, 12),
            };
        }
        if (tool === 'read_file') {
            const result = data as { path?: unknown; bytes?: unknown; truncated?: unknown; content?: unknown };
            return {
                path: result.path,
                bytes: result.bytes,
                truncated: result.truncated,
                contentPreview: typeof result.content === 'string' ? result.content.slice(0, 500) : undefined,
            };
        }
        return data;
    }
}
