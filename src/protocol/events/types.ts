import type { RuntimeEvent } from "../contracts/index.ts";

export const RuntimeEventType = {
    AgentTurnEnd: "agent.turn.end",
    AgentTurnStart: "agent.turn.start",
    BlackboardDecisionRequested: "blackboard.decision.requested",
    BlackboardLeaseAcquired: "blackboard.lease.acquired",
    BlackboardLeaseReleased: "blackboard.lease.released",
    BlackboardLivelockDetected: "blackboard.livelock.detected",
    BlackboardMessageAppended: "blackboard.message.appended",
    BlackboardTurnEnd: "blackboard.turn.end",
    BlackboardTurnStart: "blackboard.turn.start",
    BlackboardWorkerEnd: "blackboard.worker.end",
    BlackboardWorkerStart: "blackboard.worker.start",
    GatewayMessageReceived: "gateway.message.received",
    GatewayStart: "gateway.start",
    MemoryEpisodeWritten: "memory.episode.written",
    MemoryConsolidationCompleted: "memory.consolidation.completed",
    MemoryConsolidationFailed: "memory.consolidation.failed",
    MemoryDecaySwept: "memory.decay.swept",
    MemoryDreamCompleted: "memory.dream.completed",
    MemoryDreamFailed: "memory.dream.failed",
    MemoryFeedbackClassified: "memory.feedback.classified",
    MemoryFeedbackFailed: "memory.feedback.failed",
    ProjectScaffolded: "project.scaffolded",
    ProjectScaffoldFailed: "project.scaffold.failed",
    MemoryPromptBuilt: "memory.prompt.built",
    MemoryReflectionFailed: "memory.reflection.failed",
    MemoryTurnRecorded: "memory.turn.recorded",
    MemoryWarmupComplete: "memory.warmup.complete",
    PerfTtfb: "perf.ttfb",
    PerfBuildPrompt: "perf.build_prompt",
    PerfRouteLlm: "perf.route_llm",
    PerfRedisLatency: "perf.redis_latency",
    PerfSurrealAnnLatency: "perf.surreal_ann_latency",
    PerfFastRouteEvaluated: "perf.fast_route_evaluated",
    RouteEscalated: "route.escalated",
    ProcessExit: "process.exit",
    ProcessOutput: "process.output",
    ProcessOutputTruncated: "process.output.truncated",
    ProcessRestartGiveUp: "process.restart.give_up",
    ProcessStart: "process.start",
    WorkerRegistered: "worker.registered",
    WorkerTaskEnd: "worker.task.end",
    WorkerTaskFailed: "worker.task.failed",
    WorkerTaskQueued: "worker.task.queued",
    WorkerTaskStart: "worker.task.start",
} as const;

export type RuntimeEventType = (typeof RuntimeEventType)[keyof typeof RuntimeEventType];

export const FpcEventType = RuntimeEventType;
export type FpcEventType = RuntimeEventType;

export interface EventSink {
    publish(event: RuntimeEvent): void;
}
