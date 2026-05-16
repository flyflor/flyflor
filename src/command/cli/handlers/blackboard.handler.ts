import { BlackboardModule, type FlyFlor } from "../../../app.ts";

export interface BlackboardTurnItem {
    id: string;
    status: string;
    projectConstraintId: string;
    goal: string;
    stepCount: number;
    workerCount: number;
    updatedAt: string;
}

export interface BlackboardTurnDetail {
    id: string;
    status: string;
    projectConstraintId: string;
    requestId: string;
    goal: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    budget: { minRounds: number; maxRounds: number; hardMaxRounds: number };
    workers: Array<{ role: string; name: string; stage: string; handoff: string; status: string; capabilities: string[] }>;
    steps: Array<{ round: number; worker: string; risk: string; summary: string; blockers: string[]; newFacts: string[] }>;
    messages: Array<{ round?: number; role: string; content: string; visibility: string; createdAt: string }>;
    decisions: Array<{ kind: string; prompt: string; reason: string; options: Array<{ label: string; description?: string }> }>;
}

export async function fetchBlackboardTurnList(app: FlyFlor, limit: number): Promise<BlackboardTurnItem[]> {
    const blackboard = app.resolve(BlackboardModule);
    const turns = await blackboard.listRecentTurns(limit);
    return turns.map((turn) => ({
        id: turn.id,
        status: turn.status,
        projectConstraintId: turn.projectConstraintId,
        goal: turn.goal,
        stepCount: turn.steps.length,
        workerCount: turn.workers.length,
        updatedAt: turn.updatedAt,
    }));
}

export async function fetchBlackboardTurnDetail(app: FlyFlor, turnId: string): Promise<BlackboardTurnDetail | undefined> {
    const blackboard = app.resolve(BlackboardModule);
    const turn = await blackboard.getTurn(turnId);
    if (!turn) return undefined;
    return {
        id: turn.id,
        status: turn.status,
        projectConstraintId: turn.projectConstraintId,
        requestId: turn.requestId,
        goal: turn.goal,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
        completedAt: turn.completedAt,
        budget: {
            minRounds: turn.budget.minRounds,
            maxRounds: turn.budget.maxRounds,
            hardMaxRounds: turn.budget.hardMaxRounds,
        },
        workers: turn.workers.map((w) => ({
            role: w.role,
            name: w.name,
            stage: w.stage,
            handoff: w.handoff,
            status: w.status,
            capabilities: w.capabilities,
        })),
        steps: turn.steps.map((s) => ({
            round: s.round,
            worker: s.workerRole,
            risk: s.risk,
            summary: s.outputSummary,
            blockers: s.blockers ?? [],
            newFacts: s.newFacts ?? [],
        })),
        messages: turn.messages.map((m) => ({
            round: m.round,
            role: m.role,
            content: m.content,
            visibility: m.visibility,
            createdAt: m.createdAt,
        })),
        decisions: turn.decisions.map((d) => ({
            kind: d.kind,
            prompt: d.prompt,
            reason: d.reason,
            options: d.options.map((o) => ({ label: o.label, description: o.description })),
        })),
    };
}
