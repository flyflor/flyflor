import { Config, Init, Inject, Logger, Prompt, PromptScope, Service, useContainer } from '@/core';
import type { LoggerApi } from '@/core/logger';
import type { FAgentProfileConfiguration, FModelConfiguration } from '@/shard/components';
import { Agent } from '@/agent';
import { AGENT_TOPIC_SOUL_TURN } from '@/agent/types';
import type { FAgent } from '@/core';
import { CapillaryModule } from '@/capillary/module';
import { IntelligenceService, AgentChatRole, type AgentChatMessage } from '@/agent/brain';
import { ContextComponent, ContextRole } from '@/shard/components';

/**
 * The two routes the runtime may dispatch to. `fast` is the cheap, conversational path; `thinking`
 * is the deeper, multi-step path. The route is decided per turn by the route-decision oracle (see
 * `Runtime.decideRoute`) and recorded in the per-turn log.
 */
export type RuntimeRoute = 'fast' | 'thinking';

/**
 * Options accepted by `Runtime.chat`. `route` forces a route and skips the oracle (used by callers
 * that already know the right path, e.g. a future ReAct sub-task or a tool-calling dispatch).
 */
export interface RuntimeChatOptions {
    route?: RuntimeRoute;
}

/**
 * The JSON shape the route-decision oracle must return. `reason` is the human-readable justification
 * the oracle produced (≤ 8 words per the prompt spec).
 */
export interface RouteDecision {
    route: RuntimeRoute;
    reason: string;
}

/**
 * The runtime: the kernel's process-level orchestrator.
 *
 * The runtime owns a registry of `FAgent` instances keyed by profile name. The master agent is
 * spawned at boot from the configured `agent` profile. The runtime exposes `spawn(name)` to create
 * or reuse an agent, and `dispatch(content, profiles)` to run the same content through several
 * agents concurrently (the LLM-driven sub-agent topology the master uses to extract summaries, find
 * clues, or understand intents in parallel).
 *
 * The runtime is intentionally opaque to the agent's mind: it never inspects or rewrites an agent's
 * system prompt. The agent composes its own prompt internally (see `Agent.composeSystemPrompt`).
 *
 * The runtime also owns the fast→thinking route-decision oracle: the cheap `fastModel` decides
 * per-turn whether to use the cheap path or to upgrade to the deeper `thinking` path. A malformed
 * oracle response is a hard error, never a silent fallback (AGENTS.md red line 3).
 */
@Service()
export class Runtime {
    @Config('agent')
    public readonly activeAgent!: string;

    @Config('agents')
    public readonly agents!: Record<string, FAgentProfileConfiguration>;

    @Config('model')
    public readonly llm!: FModelConfiguration;

    @Inject()
    public readonly intelligence!: IntelligenceService;

    @Inject()
    public readonly capillary!: CapillaryModule;

    @Inject()
    public readonly context!: ContextComponent;

    @Logger('runtime')
    public readonly log!: LoggerApi;

    /** The route-decision system prompt loaded from `prompts/runtime.md` (English canonical, red line 5). */
    @Prompt('runtime', PromptScope.GLOBAL)
    public readonly routingPrompt!: string;

    /**
     * Multi-agent registry: profile name → live `FAgent` instance. The master agent lives at
     * `activeAgent`; sub-agents are spawned on demand by the LLM via the master's prompt engineering.
     */
    private readonly workers = new Map<string, FAgent>();

    /**
     * Spawns the master agent from the configured `activeAgent` profile and logs the runtime as
     * ready. The master agent's `@Init` runs the constitution-layer soul check before this method
     * returns, so a missing soul file is fatal at boot.
     */
    @Init()
    public async init(): Promise<void> {
        const master = await this.spawn(this.activeAgent);
        this.log.info('runtime ready', {
            master: master.profile.name,
            llmModel: this.llm.model || this.llm.default,
            fastModel: this.llm.fastModel || this.llm.model || this.llm.default,
        });
    }

    /**
     * Returns the live master agent. Throws if the master is not yet initialized (red line 3).
     */
    public get master(): FAgent {
        const agent = this.workers.get(this.activeAgent);
        if (agent === undefined) {
            throw Object.assign(Error('Runtime master agent is not initialized'), {
                detail: { activeAgent: this.activeAgent, workerCount: this.workers.size },
            });
        }
        return agent;
    }

    /**
     * Spawns or reuses one agent instance by profile name. The first call constructs the agent
     * through the container (the only `new` entry, red line 9); subsequent calls return the same
     * instance. The master and sub-agents are all `FAgent` peers; the runtime does not distinguish.
     * @param profileName - the agent profile key from the `agents` config map.
     * @returns the live agent instance.
     */
    public async spawn(profileName: string): Promise<FAgent> {
        const cached = this.workers.get(profileName);
        if (cached !== undefined) {
            return cached;
        }
        const profile = this.resolveProfile(profileName);
        const agent = await useContainer().getAsync(Agent, profile);
        this.workers.set(profileName, agent);
        this.log.info('agent spawned', { profile: profileName });
        await this.capillary.notice('runtime.spawn', { profile: profileName });
        return agent;
    }

    /**
     * Runs the same content through several agents concurrently. The LLM-driven master uses this
     * for parallel sub-tasks: extract summary, find clues, understand intent. The same profile may
     * appear multiple times in `profiles`; `spawn` returns the cached instance so the same agent
     * runs the chat repeatedly (the master's job is to aggregate, not to fan out distinct agents).
     * @param content - the user turn to fan out.
     * @param profiles - the agent profile names to run.
     * @returns a profile-name → reply map.
     */
    public async dispatch(content: string, profiles: readonly string[]): Promise<Record<string, string>> {
        const agents = await Promise.all(profiles.map((p) => this.spawn(p)));
        const pairs = await Promise.all(
            profiles.map(async (profile, index): Promise<readonly [string, string]> => {
                const reply = await agents[index]!.chat(content);
                return [profile, reply] as const;
            }),
        );
        return Object.fromEntries(pairs);
    }

    /**
     * Sends one user turn to the master agent. Decides the route (or honors the caller override),
     * forwards to the master, and broadcasts a `AGENT_TOPIC_SOUL_TURN` notice for downstream observers.
     * @param content - raw user text received from an external transport.
     * @param opts - optional route override; when absent, the route-decision oracle picks.
     * @returns the model-backed agent reply.
     */
    public async chat(content: string, opts: RuntimeChatOptions = {}): Promise<string> {
        const master = this.master;
        const decision = opts.route !== undefined ? null : await this.decideRoute(content);
        const route: RuntimeRoute = opts.route ?? decision!.route;
        this.log.info('route decided', { route, reason: decision?.reason, userChars: content.length });
        this.context.append(ContextRole.User, content);
        const reply = await master.chat(content);
        this.context.append(ContextRole.Agent, reply);
        await this.capillary.notice(AGENT_TOPIC_SOUL_TURN, { role: 'user', content });
        return reply;
    }

    /**
     * Calls the route-decision oracle: `prompts/runtime.md` as system prompt, the user turn as user,
     * and the cheap `fastModel` as the model. Returns a parsed `RouteDecision`. A malformed response
     * is a hard error (red line 3, no silent fallback).
     * @param content - the user turn the oracle must classify.
     * @returns the parsed route and the oracle's reason.
     */
    public async decideRoute(content: string): Promise<RouteDecision> {
        const messages: AgentChatMessage[] = [
            { role: AgentChatRole.System, content: this.routingPrompt },
            { role: AgentChatRole.User, content },
        ];
        const fastModel = this.llm.fastModel || this.llm.model || this.llm.default;
        const raw = await this.intelligence.complete(messages, fastModel);
        return this.parseRouteDecision(raw);
    }

    /**
     * Merges the configured agent profile with global LLM defaults. Per-agent fields win; missing
     * fields fall back to the global `model` and then to the global `default`. Missing profile is
     * a hard error, not a silent default.
     * @returns the resolved profile.
     */
    private resolveProfile(profileName: string): FAgentProfileConfiguration {
        const profile = this.agents[profileName];
        if (profile === undefined) {
            throw Object.assign(Error('Runtime agent profile is missing'), {
                detail: { requested: profileName, knownAgents: Object.keys(this.agents) },
            });
        }
        return {
            name: profile.name,
            model: profile.model || this.llm.model || this.llm.default,
            provider: profile.provider || this.llm.provider,
        };
    }

    /**
     * Parses the oracle's raw response into a `RouteDecision`. The oracle's prompt forbids prose
     * outside the JSON object; anything that fails the parse is treated as a hard protocol violation.
     * @param raw - the raw oracle output.
     * @returns the parsed route decision.
     */
    private parseRouteDecision(raw: string): RouteDecision {
        const trimmed = raw.trim();
        const fenceMatch = /^```(?:json)?\s*([\s\S]+?)\s*```$/i.exec(trimmed);
        const body = fenceMatch !== null && fenceMatch[1] !== undefined ? fenceMatch[1] : trimmed;
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch (cause) {
            throw Object.assign(Error('Route decision parse failed: invalid JSON'), {
                detail: { raw: trimmed, cause: String(cause) },
            });
        }
        if (typeof parsed !== 'object' || parsed === null) {
            throw Object.assign(Error('Route decision parse failed: not an object'), { detail: { raw: trimmed } });
        }
        const candidate = parsed as { route?: unknown; reason?: unknown };
        const route: RuntimeRoute = candidate.route === 'fast' || candidate.route === 'thinking'
            ? candidate.route
            : (() => {
                throw Object.assign(Error('Route decision parse failed: invalid route'), {
                    detail: { raw: trimmed, route: candidate.route },
                });
            })();
        if (typeof candidate.reason !== 'string') {
            throw Object.assign(Error('Route decision parse failed: reason is not a string'), {
                detail: { raw: trimmed },
            });
        }
        return { route, reason: candidate.reason };
    }
}
