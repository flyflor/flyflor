import type { FlyflorConfig } from "../../../config/index.ts";
import type {
    BlackboardMode as BlackboardModeType,
    BlackboardTurnStatus as BlackboardTurnStatusType,
    GatewayMessage,
    ModelClient,
    RuntimeContext,
} from "../../../protocol/contracts/index.ts";
import { BlackboardMode } from "../../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../../events/index.ts";
import type { BlackboardDecision } from "../../blackboard/index.ts";
import type { MemoryEpisodeProvenance, MemoryModule } from "../../../cognitive/hippocampus/memory/index.ts";
import { extractRuntimeReflectionCandidates } from "./index.ts";
import { ReflectionThreadRunner } from "./thread.runner.ts";
import type { RuntimeBlackboardRouteDecision } from "../blackboard/route.ts";

export interface ReflectionBlackboardRun {
    decisions: BlackboardDecision[];
    mode: BlackboardModeType;
    reason: string;
    metadata: Record<string, unknown>;
    steps: Array<{
        blockers: string[];
        newFacts: string[];
        outputSummary: string;
        workerRole: string;
    }>;
    status?: BlackboardTurnStatusType;
    turnId?: string;
}

export interface ReflectionWorkerInput {
    blackboardRun?: ReflectionBlackboardRun;
    context: RuntimeContext;
    executiveToolLoop?: {
        loopGuardReason?: string;
        message: string;
        stop: "ask";
        toolBudgetExhausted?: true;
    };
    message: GatewayMessage;
    provenance: MemoryEpisodeProvenance;
    visibleText: string;
}

export interface ReflectionWorkerOptions {
    config?: FlyflorConfig;
    events: EventSink;
    memory: Pick<MemoryModule, "applyReflection">;
    model: ModelClient;
    normalizer?: ReflectionThreadRunner;
}

export class ReflectionWorker {
    private readonly normalizer: ReflectionThreadRunner;
    private readonly ownsNormalizer: boolean;

    public constructor(private readonly options: ReflectionWorkerOptions) {
        this.normalizer = options.normalizer ?? new ReflectionThreadRunner();
        this.ownsNormalizer = !options.normalizer;
    }

    public async dispatch(input: ReflectionWorkerInput): Promise<void> {
        if (!this.shouldExtract(input.blackboardRun, input.provenance.mcpCalls, input.executiveToolLoop)) {
            return;
        }
        try {
            const candidates = await extractRuntimeReflectionCandidates(
                this.options.model,
                {
                    answer: input.visibleText,
                    blackboard: input.blackboardRun
                        ? {
                              decisions: input.blackboardRun.decisions.map((decision) => ({
                                  prompt: decision.prompt,
                                  reason: decision.reason,
                              })),
                              mode: input.blackboardRun.mode,
                              reason: input.blackboardRun.reason,
                              status: input.blackboardRun.status,
                              steps: input.blackboardRun.steps.map((step) => ({
                                  blockers: step.blockers,
                                  newFacts: step.newFacts,
                                  outputSummary: step.outputSummary,
                                  workerRole: step.workerRole,
                              })),
                              turnId: input.blackboardRun.turnId,
                          }
                        : undefined,
                    now: input.context.now,
                    request: input.message.text,
                    requestId: input.context.requestId,
                    route: readRouteMetadata(input.blackboardRun?.metadata),
                    executiveToolLoop: input.executiveToolLoop,
                    mcpCalls: input.provenance.mcpCalls,
                    skillNames: input.provenance.skillNames,
                },
                this.normalizer,
            );
            if (candidates.length > 0) {
                await this.options.memory.applyReflection(candidates, input.context);
            }
        } catch (error) {
            this.options.events.publish(
                event(
                    RuntimeEventType.MemoryReflectionFailed,
                    { error: error instanceof Error ? error.message : String(error) },
                    input.context.requestId,
                ),
            );
        }
    }

    public dispose(): void {
        if (this.ownsNormalizer) {
            this.normalizer.dispose();
        }
    }

    private shouldExtract(
        run: ReflectionBlackboardRun | undefined,
        mcpCalls: MemoryEpisodeProvenance["mcpCalls"] = [],
        executiveToolLoop?: ReflectionWorkerInput["executiveToolLoop"],
    ): boolean {
        if (executiveToolLoop) return true;
        if ((mcpCalls ?? []).some((call) => call.ok)) {
            return true;
        }
        if (!run) return false;
        const route = readRouteMetadata(run.metadata);
        return run.mode === BlackboardMode.Blackboard || route?.needsReflectionCandidate === true;
    }
}

function readRouteMetadata(metadata: Record<string, unknown> | undefined): RuntimeBlackboardRouteDecision | undefined {
    const raw = metadata?.routeDecision ?? metadata?.route;
    if (!raw || typeof raw !== "object") return undefined;
    const candidate = raw as RuntimeBlackboardRouteDecision;
    if (
        candidate.mode !== BlackboardMode.Direct &&
        candidate.mode !== BlackboardMode.DirectWithWatch &&
        candidate.mode !== BlackboardMode.Blackboard
    ) {
        return undefined;
    }
    return {
        blackboardContract: candidate.blackboardContract,
        mode: candidate.mode,
        needsReflectionCandidate: candidate.needsReflectionCandidate === true,
        reason: typeof candidate.reason === "string" ? candidate.reason : "metadata-route",
        score: typeof candidate.score === "number" ? candidate.score : 0,
        signals: Array.isArray(candidate.signals) ? candidate.signals.filter((s): s is string => typeof s === "string") : [],
        raw: typeof candidate.raw === "string" ? candidate.raw : JSON.stringify(candidate),
        workers: Array.isArray(candidate.workers) ? candidate.workers : [],
    };
}
