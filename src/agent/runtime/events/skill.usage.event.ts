import { Event } from "../../di/decorators/index.ts";
import type { FlyflorConfig, FlyflorPaths } from "../../../config/index.ts";
import type { RuntimeEvent } from "../../../protocol/contracts/index.ts";
import { RuntimeEventType } from "../../../events/index.ts";
import { recordSkillUsageSelections, type SkillSource, type SkillUsageSelection } from "../../../skills/index.ts";

interface RuntimeSkillUsageDraft {
    mcpCallCount: number;
    mcpSuccessCount: number;
    selected: SkillUsageSelection[];
}

/**
 * Event handler for runtime skill usage accounting.
 *
 * Runtime emits structured signals; this handler aggregates them by requestId
 * and writes the sidecar usage files after the turn ends. This keeps auxiliary
 * statistics out of the main turn pipeline without changing model behavior.
 */
export class RuntimeSkillUsageEventHandler {
    private readonly drafts = new Map<string, RuntimeSkillUsageDraft>();

    public constructor(private readonly config: Pick<FlyflorConfig, "paths"> | { paths: FlyflorPaths }) {}

    @Event(RuntimeEventType.SkillContextBuilt)
    public onSkillContextBuilt(event: RuntimeEvent): void {
        const requestId = event.requestId;
        if (!requestId) return;
        const selected = readSelectedSkills(event.payload);
        const draft = this.draftFor(requestId);
        draft.selected = selected;
    }

    @Event(RuntimeEventType.McpToolCallExecuted)
    public onMcpToolCallExecuted(event: RuntimeEvent): void {
        const requestId = event.requestId;
        if (!requestId) return;
        const draft = this.draftFor(requestId);
        draft.mcpCallCount += 1;
        if (event.payload?.ok === true) {
            draft.mcpSuccessCount += 1;
        }
    }

    @Event(RuntimeEventType.AgentTurnEnd)
    public async onAgentTurnEnd(event: RuntimeEvent): Promise<void> {
        const requestId = event.requestId;
        if (!requestId) return;
        const draft = this.drafts.get(requestId);
        this.drafts.delete(requestId);
        if (!draft || draft.selected.length === 0) return;
        await recordSkillUsageSelections(this.config.paths, draft.selected, {
            mcpCallCount: draft.mcpCallCount,
            mcpSuccessCount: draft.mcpSuccessCount,
            now: event.at,
            requestId,
        });
    }

    @Event(RuntimeEventType.MemoryBrainWriteFailed)
    public onTurnFailure(event: RuntimeEvent): void {
        const requestId = event.requestId;
        if (requestId) {
            this.drafts.delete(requestId);
        }
    }

    private draftFor(requestId: string): RuntimeSkillUsageDraft {
        const existing = this.drafts.get(requestId);
        if (existing) return existing;
        const draft: RuntimeSkillUsageDraft = { mcpCallCount: 0, mcpSuccessCount: 0, selected: [] };
        this.drafts.set(requestId, draft);
        return draft;
    }
}

function readSelectedSkills(payload: Record<string, unknown> | undefined): SkillUsageSelection[] {
    const selected = Array.isArray(payload?.selected) ? payload.selected : [];
    return selected.flatMap((item) => {
        if (!isRecord(item)) return [];
        const name = typeof item.name === "string" ? item.name : undefined;
        const source = readSkillSource(item.source);
        if (!name || !source) return [];
        return [
            {
                capabilities: readStringArray(item.capabilities),
                compatibility: readStringArray(item.compatibility),
                name,
                source,
            },
        ];
    });
}

function readSkillSource(value: unknown): SkillSource | undefined {
    return value === "project" || value === "global" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
