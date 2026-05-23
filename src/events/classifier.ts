import { RuntimeEventClass, type RuntimeEventClass as RuntimeEventClassType } from "../protocol/contracts/index.ts";
import { RuntimeEventType } from "./types.ts";

const EXPLICIT_CLASSES: Readonly<Record<string, RuntimeEventClassType>> = {
    [RuntimeEventType.MemoryAskAnswered]: RuntimeEventClass.Ask,
    [RuntimeEventType.MemoryAskChainCapped]: RuntimeEventClass.Ask,
    [RuntimeEventType.MemoryAskMutexViolation]: RuntimeEventClass.Ask,
    [RuntimeEventType.MemoryAskRecorded]: RuntimeEventClass.Ask,
    [RuntimeEventType.ExecutiveLoopPaused]: RuntimeEventClass.Ask,
    [RuntimeEventType.ExecutiveLoopResumed]: RuntimeEventClass.Ask,
    [RuntimeEventType.BlackboardDecisionRequested]: RuntimeEventClass.Question,
    [RuntimeEventType.MemoryScopeOfferProposed]: RuntimeEventClass.Question,
    [RuntimeEventType.MemorySkillOfferProposed]: RuntimeEventClass.Question,
    [RuntimeEventType.ScopeRecallAsk]: RuntimeEventClass.Question,
    [RuntimeEventType.ScopeRecallLoaded]: RuntimeEventClass.Read,
    [RuntimeEventType.ToolAskRequired]: RuntimeEventClass.Ask,
    [RuntimeEventType.ToolBudgetExhausted]: RuntimeEventClass.Ask,
    [RuntimeEventType.ToolFailed]: RuntimeEventClass.Error,
    [RuntimeEventType.ToolOutputPersisted]: RuntimeEventClass.Write,
};

/**
 * Runtime event classes are a stable subscription layer for WS, TUI and
 * channel adapters. The mapping is protocol-prefix based, not user-text based,
 * so it does not participate in business semantic routing.
 */
export class RuntimeEventClassifier {
    public classify(type: string): RuntimeEventClassType {
        const explicit = EXPLICIT_CLASSES[type];
        if (explicit) {
            return explicit;
        }
        if (type.startsWith("perf.")) {
            return RuntimeEventClass.Performance;
        }
        if (type.includes(".failed") || type.includes(".error") || type.includes(".denied")) {
            return RuntimeEventClass.Error;
        }
        if (
            type.includes(".written") ||
            type.includes(".recorded") ||
            type.includes(".updated") ||
            type.includes(".appended") ||
            type.includes(".reverted") ||
            type.includes(".pinned") ||
            type.includes(".dropped") ||
            type.includes(".consumed") ||
            type.includes(".installed")
        ) {
            return RuntimeEventClass.Write;
        }
        if (type.includes(".recall") || type.includes(".recalled") || type.includes(".catalog.built")) {
            return RuntimeEventClass.Read;
        }
        if (
            type.startsWith("executive.") ||
            type.startsWith("sandbox.") ||
            type.startsWith("plugin.") ||
            type.startsWith("mcp.") ||
            type.startsWith("process.") ||
            type.startsWith("tool.") ||
            type.startsWith("worker.")
        ) {
            return RuntimeEventClass.Effect;
        }
        if (type.startsWith("gateway.") || type.startsWith("channel.") || type.startsWith("runtime.mode.")) {
            return RuntimeEventClass.Control;
        }
        return RuntimeEventClass.Lifecycle;
    }
}

export const runtimeEventClassifier = new RuntimeEventClassifier();

export function classifyRuntimeEvent(type: string): RuntimeEventClassType {
    return runtimeEventClassifier.classify(type);
}
