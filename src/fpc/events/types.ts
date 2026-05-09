import type { RuntimeEvent } from "../contracts/index.ts";

export const FpcEventType = {
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
    MemoryPromptBuilt: "memory.prompt.built",
    MemoryQdrantDegraded: "memory.qdrant.degraded",
    MemoryTurnRecorded: "memory.turn.recorded",
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

export type FpcEventType = (typeof FpcEventType)[keyof typeof FpcEventType];

export interface EventSink {
    publish(event: RuntimeEvent): void;
}
