import { FileService, FService, Inject, Logger, Prompt, Service, useContainer, type FLogger } from '@/core';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import { ROOT_PATH } from '@/config';
import { CodeGraphPlugin, GlobPlugin, GrepPlugin, ReadFilePlugin, RtkPlugin, type InvestigationObservation, type InvestigationObserveContext, type InvestigationObserveRequest, type InvestigationPipePlugin, type InvestigationSourcePlugin } from '@/plugins/tools';
import { AgentChatRole, Intelligence } from '../intelligence';
import type { BrainInvestigationRequest, BrainInvestigationResult, BrainInvestigationState } from './types';

const MAX_INVESTIGATION_TOOL_ROUNDS = 5;
const INVESTIGATION_LOG_PREVIEW_LENGTH = 160;

@Service()
export class Investigation extends FService {
    @Logger(Investigation.name)
    public readonly log!: FLogger;

    @Inject(async function (this: Investigation) {
        const { model } = await useContainer().getAsync(ConfigComponent);
        return {
            llm: model,
            modelOverride: this.config.model || undefined,
            maxTokens: this.config.maxTokens || model.maxTokens,
        };
    })
    public intelligence!: Intelligence;

    @Inject()
    public readFile!: ReadFilePlugin;

    @Inject()
    public glob!: GlobPlugin;

    @Inject()
    public grep!: GrepPlugin;

    @Inject()
    public rtk!: RtkPlugin;

    @Inject()
    public codegraph!: CodeGraphPlugin;

    @Prompt('agent/INVESTIGATION.md')
    public prompt!: FileService<string>;

    public constructor(public readonly config: FAgentProfileConfiguration) {
        super();
    }

    public async investigate(request: BrainInvestigationRequest): Promise<BrainInvestigationResult> {
        const observations: InvestigationObservation[] = [];
        this.log.info('investigation.start', {
            userMessageLength: request.content.length,
            contextMessages: request.context.length,
            maxToolRounds: MAX_INVESTIGATION_TOOL_ROUNDS,
        });

        let state = await this.ask(request, observations, 0);
        this.logState(0, state, observations);
        for (let round = 1; round <= MAX_INVESTIGATION_TOOL_ROUNDS; round += 1) {
            const observeRequests = this.observeRequests(state);
            if (observeRequests.length === 0) break;
            for (const observeRequest of observeRequests) {
                this.log.info('investigation.observe_request', {
                    round,
                    request: this.describeObserveRequest(observeRequest),
                });
                const observation = await this.observe(observeRequest);
                observations.push(observation);
                this.log.info('investigation.observe_result', {
                    round,
                    observation: this.describeObservation(observation),
                });
            }
            state = await this.ask(request, observations, round, state);
            this.logState(round, state, observations);
        }
        const publicState = this.withoutObserveRequests(state);
        this.log.info('investigation.complete', {
            confidence: publicState.confidence,
            observations: observations.length,
            hasNextQuestion: publicState.next_question.length > 0,
        });
        return { state: publicState, observations };
    }

    private async ask(request: BrainInvestigationRequest, observations: InvestigationObservation[], round: number, state?: BrainInvestigationState): Promise<BrainInvestigationState> {
        this.log.info('investigation.ask', {
            round,
            observations: observations.length,
            previousConfidence: state?.confidence,
        });
        const response = await this.intelligence.complete([
            { role: AgentChatRole.System, content: this.prompt.render() },
            { role: AgentChatRole.User, content: this.renderRequest(request, observations, state) },
        ]);
        this.log.info('investigation.llm_response', {
            round,
            responseLength: response.length,
            response,
        });
        return this.parseState(response, request.content, round);
    }

    private renderRequest(request: BrainInvestigationRequest, observations: InvestigationObservation[], state?: BrainInvestigationState): string {
        return JSON.stringify({
            user_message: request.content,
            conversation_context: request.context,
            previous_investigation: state,
            tool_observations: observations,
        }, null, 4);
    }

    private parseState(response: string, content: string, round: number): BrainInvestigationState {
        const parsed = this.parseJsonObject(response);
        if (parsed === undefined) {
            this.log.warn('investigation.parse_failed', {
                round,
                responseLength: response.length,
                responsePreview: this.preview(response),
            });
            return this.fallbackState(content, response);
        }
        return this.normalizeState(parsed, content);
    }

    private parseJsonObject(response: string): Record<string, unknown> | undefined {
        const trimmed = response.trim();
        const unwrapped = trimmed.startsWith('```') ? this.unwrapFence(trimmed) : trimmed;
        const start = unwrapped.indexOf('{');
        const end = unwrapped.lastIndexOf('}');
        if (start === -1 || end === -1 || end < start) return undefined;
        try {
            const parsed = JSON.parse(unwrapped.slice(start, end + 1)) as unknown;
            return this.isRecord(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    private unwrapFence(value: string): string {
        return value.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
    }

    private normalizeState(value: Record<string, unknown>, content: string): BrainInvestigationState {
        return {
            explicit_requests: this.stringArray(value.explicit_requests),
            implicit_goals: this.stringArray(value.implicit_goals),
            constraints: this.stringArray(value.constraints),
            unknowns: this.stringArray(value.unknowns),
            hypotheses: this.hypotheses(value.hypotheses),
            evidence: this.stringArray(value.evidence),
            information_needed: this.stringArray(value.information_needed),
            next_question: this.stringValue(value.next_question),
            confidence: this.confidence(value.confidence),
            observe_requests: this.requests(value.observe_requests),
        };
    }

    private fallbackState(content: string, response: string): BrainInvestigationState {
        return {
            explicit_requests: [content],
            implicit_goals: [],
            constraints: [],
            unknowns: ['investigation output was not valid JSON'],
            hypotheses: [],
            evidence: [response],
            information_needed: [],
            next_question: '',
            confidence: 0,
        };
    }

    private hypotheses(value: unknown): BrainInvestigationState['hypotheses'] {
        if (!Array.isArray(value)) return [];
        return value.filter(this.isRecord).map((item) => ({
            goal: this.stringValue(item.goal),
            supporting_evidence: this.stringArray(item.supporting_evidence),
            missing_evidence: this.stringArray(item.missing_evidence),
            confidence: this.confidence(item.confidence),
        })).filter((item) => item.goal.length > 0);
    }

    private requests(value: unknown): InvestigationObserveRequest[] | undefined {
        if (!Array.isArray(value)) return undefined;
        const requests = value.filter(this.isRecord).map((item) => ({
            goal: this.stringValue(item.goal),
            kind: this.stringValue(item.kind) as InvestigationObserveRequest['kind'],
            query: this.optionalString(item.query),
            path: this.optionalString(item.path),
            symbol: this.optionalString(item.symbol),
            relation: this.relation(item.relation),
            caseSensitive: typeof item.caseSensitive === 'boolean' ? item.caseSensitive : undefined,
            maxMatches: this.optionalNumber(item.maxMatches),
            maxBytes: this.optionalNumber(item.maxBytes),
            timeoutMs: this.optionalNumber(item.timeoutMs),
            pipes: this.stringArray(item.pipes),
        })).filter((item) => item.goal.length > 0 && this.isObserveKind(item.kind));
        return requests.length > 0 ? requests : undefined;
    }

    private observeRequests(state: BrainInvestigationState): InvestigationObserveRequest[] {
        return state.observe_requests ?? [];
    }

    private withoutObserveRequests(state: BrainInvestigationState): BrainInvestigationState {
        const { observe_requests, ...publicState } = state;
        return publicState;
    }

    private async observe(request: InvestigationObserveRequest): Promise<InvestigationObservation> {
        const context: InvestigationObserveContext = { rootPath: ROOT_PATH };
        const source = this.sources().find((candidate) => candidate.canObserve(request));
        if (source === undefined) {
            return {
                ok: false,
                source: 'investigation',
                pipes: [],
                code: 'source_not_found',
                summary: `No observation source can handle kind: ${request.kind}`,
                evidence: [],
                error: `Unsupported observation kind: ${request.kind}`,
            };
        }
        let next = () => source.observe(request, context);
        for (const pipeName of [...(request.pipes ?? [])].reverse()) {
            const pipe = this.pipes().find((candidate) => candidate.name === pipeName);
            if (pipe === undefined || !pipe.canPipe(request, context)) {
                const previous = next;
                next = async () => this.annotate(await previous(), pipeName, pipe === undefined ? 'pipe_not_found' : 'pipe_not_supported');
                continue;
            }
            const previous = next;
            next = () => pipe.pipeObservation(previous, request, context);
        }
        return next();
    }

    private stringArray(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
    }

    private stringValue(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }

    private optionalString(value: unknown): string | undefined {
        const string = this.stringValue(value);
        return string.length > 0 ? string : undefined;
    }

    private optionalNumber(value: unknown): number | undefined {
        return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
    }

    private relation(value: unknown): InvestigationObserveRequest['relation'] | undefined {
        return value === 'callers' || value === 'callees' ? value : undefined;
    }

    private isObserveKind(value: string): value is InvestigationObserveRequest['kind'] {
        return ['file', 'files', 'search', 'status', 'code_symbol', 'code_relation', 'code_impact', 'code_affected'].includes(value);
    }

    private confidence(value: unknown): number {
        if (typeof value !== 'number' || Number.isNaN(value)) return 0;
        return Math.min(1, Math.max(0, value));
    }

    private sources(): InvestigationSourcePlugin[] {
        return [this.codegraph, this.readFile, this.grep, this.glob];
    }

    private pipes(): InvestigationPipePlugin[] {
        return [this.rtk];
    }

    private annotate(observation: InvestigationObservation, pipe: string, code: string): InvestigationObservation {
        return {
            ...observation,
            data: {
                ...(this.isRecord(observation.data) ? observation.data : {}),
                pipe_status: { name: pipe, code },
            },
        };
    }

    private logState(round: number, state: BrainInvestigationState, observations: InvestigationObservation[]): void {
        this.log.info('investigation.state', {
            round,
            confidence: state.confidence,
            observations: observations.length,
            explicit_requests: this.previewStrings(state.explicit_requests),
            implicit_goals: this.previewStrings(state.implicit_goals),
            constraints: this.previewStrings(state.constraints),
            unknowns: this.previewStrings(state.unknowns),
            information_needed: this.previewStrings(state.information_needed),
            hypotheses: state.hypotheses.map((hypothesis) => ({
                goal: this.preview(hypothesis.goal),
                confidence: hypothesis.confidence,
            })),
            next_question: this.preview(state.next_question),
            observe_requests: this.observeRequests(state).map((request) => this.describeObserveRequest(request)),
        });
    }

    private describeObserveRequest(request: InvestigationObserveRequest): Record<string, unknown> {
        return {
            goal: this.preview(request.goal),
            kind: request.kind,
            query: request.query,
            path: request.path,
            symbol: request.symbol,
            relation: request.relation,
            caseSensitive: request.caseSensitive,
            maxMatches: request.maxMatches,
            maxBytes: request.maxBytes,
            timeoutMs: request.timeoutMs,
            pipes: request.pipes ?? [],
        };
    }

    private describeObservation(observation: InvestigationObservation): Record<string, unknown> {
        return {
            source: observation.source,
            pipes: observation.pipes,
            ok: observation.ok,
            code: observation.code,
            summary: this.preview(observation.summary),
            evidenceCount: observation.evidence.length,
            truncated: observation.truncated === true,
            error: observation.error === undefined ? undefined : this.preview(observation.error),
        };
    }

    private previewStrings(values: string[]): string[] {
        return values.map((value) => this.preview(value));
    }

    private preview(value: string): string {
        const normalized = value.replace(/\s+/g, ' ').trim();
        if (normalized.length <= INVESTIGATION_LOG_PREVIEW_LENGTH) return normalized;
        return `${normalized.slice(0, INVESTIGATION_LOG_PREVIEW_LENGTH - 3)}...`;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
