import { BlackboardMode, ModelRole, type ModelClient, type ModelMessage } from "../../../protocol/contracts/index.ts";
import type { BlackboardContract, BlackboardWorkerPlanInput } from "../../blackboard/index.ts";
import { Component } from "../../../agent/di/decorators/index.ts";
import { Runtime } from "../../../components/component.ts";
import { renderBlackboardRoutePrompt } from "../../prompts/index.ts";

const MAX_ROUTE_WORKERS = 5;

export interface RuntimeBlackboardRouteDecision {
    mode: BlackboardMode;
    score: number;
    reason: string;
    signals: string[];
    needsReflectionCandidate: boolean;
    blackboardContract: BlackboardContract;
    workers: BlackboardWorkerPlanInput[];
    raw: string;
}

@Component()
export class RuntimeBlackboardRouteComponent extends Runtime {
    public async decideBlackboardRoute(
        model: ModelClient,
        request: string,
    ): Promise<RuntimeBlackboardRouteDecision> {
        const messages: ModelMessage[] = [
            {
                role: ModelRole.System,
                content: renderBlackboardRoutePrompt({ request }),
            },
            {
                role: ModelRole.User,
                content: request,
            },
        ];
        const raw = await model.generate(messages);
        return this.parseBlackboardRouteDecision(raw);
    }

    public parseBlackboardRouteDecision(raw: string): RuntimeBlackboardRouteDecision {
        const parsed = this.parseJsonObject(raw);
        const mode = this.readMode(parsed.mode);
        const score = this.readScore(parsed.score);
        return {
            mode,
            score,
            reason: this.readRequiredString(parsed.reason, "reason"),
            signals: this.readStringArray(parsed.signals),
            needsReflectionCandidate: parsed.needsReflectionCandidate === true,
            blackboardContract: this.readBlackboardContract(parsed.blackboardContract, mode),
            workers: this.readWorkers(parsed.workers, mode),
            raw,
        };
    }

    private parseJsonObject(raw: string): Record<string, unknown> {
        const trimmed = raw.trim();
        const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u)?.[1]?.trim();
        const source = fenced ?? trimmed;
        const start = source.indexOf("{");
        const end = source.lastIndexOf("}");
        if (start < 0 || end < start) {
            throw new Error("Blackboard route model did not return a JSON object.");
        }
        const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Blackboard route model returned invalid JSON.");
        }
        return parsed as Record<string, unknown>;
    }

    private readMode(value: unknown): BlackboardMode {
        if (
            value === BlackboardMode.Direct ||
            value === BlackboardMode.DirectWithWatch ||
            value === BlackboardMode.Blackboard
        ) {
            return value;
        }
        throw new Error(`Blackboard route model returned unsupported mode: ${String(value)}`);
    }

    private readScore(value: unknown): number {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error(`Blackboard route model returned invalid score: ${String(value)}`);
        }
        return value;
    }

    private readRequiredString(value: unknown, field: string): string {
        if (typeof value !== "string" || !value.trim()) {
            throw new Error(`Blackboard route model returned invalid ${field}.`);
        }
        return value.trim();
    }

    private readStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }

    private readWorkers(value: unknown, mode: BlackboardMode): BlackboardWorkerPlanInput[] {
        if (mode !== BlackboardMode.Blackboard) {
            return [];
        }
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error("Blackboard route model must return workers for blackboard mode.");
        }
        return this.normalizeWorkerPlan(
            value.map((item, index) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) {
                    throw new Error(`Blackboard worker plan item ${index + 1} is invalid.`);
                }
                const candidate = item as Record<string, unknown>;
                const rawRole = this.pickWorkerLabel(candidate, ["role", "id", "key"]);
                const rawName = this.pickWorkerLabel(candidate, ["name", "title", "label", "displayName"]);
                const rawStage = this.pickWorkerLabel(candidate, ["stage", "phase", "step"]);
                const roleSeed = rawRole || rawName || rawStage || `worker-${index + 1}`;
                const role = this.normalizeWorkerRole(roleSeed) || `worker-${index + 1}`;
                const name = rawName || this.humanizeRole(role);
                const stage = rawStage || `worker-${index + 1}`;
                return {
                    capabilities: this.readStringArray(candidate.capabilities),
                    dependsOn: this.readStringArray(candidate.dependsOn)
                        .map((dependency) => this.normalizeWorkerRole(dependency))
                        .filter(Boolean),
                    handoff: this.readHandoff(candidate.handoff),
                    name,
                    role,
                    stage,
                };
            }),
        );
    }

    private pickWorkerLabel(candidate: Record<string, unknown>, keys: readonly string[]): string {
        for (const key of keys) {
            const direct = candidate[key];
            if (typeof direct === "string" && direct.trim()) {
                return direct.trim();
            }
        }
        const lowered = new Map<string, unknown>();
        for (const [key, value] of Object.entries(candidate)) {
            lowered.set(key.toLowerCase(), value);
        }
        for (const key of keys) {
            const value = lowered.get(key.toLowerCase());
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }
        return "";
    }

    private readBlackboardContract(value: unknown, mode: BlackboardMode): BlackboardContract {
        if (mode !== BlackboardMode.Blackboard || !value || typeof value !== "object" || Array.isArray(value)) {
            return this.normalBlackboardContract();
        }
        const candidate = value as Record<string, unknown>;
        const contractMode = candidate.mode === "non-convergent" ? "non-convergent" : "normal";
        return {
            contradictions: this.readContradictions(candidate.contradictions),
            evidence: this.readStringArray(candidate.evidence),
            mode: contractMode,
            policyReason:
                contractMode === "non-convergent"
                    ? this.readRequiredString(candidate.policyReason, "blackboardContract.policyReason")
                    : this.readOptionalString(candidate.policyReason) ?? "default-convergence",
            proposition: this.readOptionalString(candidate.proposition),
            reviewerTrigger: this.readOptionalString(candidate.reviewerTrigger),
        };
    }

    private normalBlackboardContract(): BlackboardContract {
        return {
            contradictions: [],
            evidence: [],
            mode: "normal",
            policyReason: "default-convergence",
        };
    }

    private readContradictions(value: unknown): BlackboardContract["contradictions"] {
        if (!Array.isArray(value)) {
            return [];
        }
        return value
            .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
            .map((item) => ({
                left: this.readRequiredString(item.left, "blackboardContract.contradictions.left"),
                reason: this.readRequiredString(item.reason, "blackboardContract.contradictions.reason"),
                right: this.readRequiredString(item.right, "blackboardContract.contradictions.right"),
            }))
            .filter((item) => item.left && item.right && item.reason)
            .slice(0, 8);
    }

    private readOptionalString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
    }

    private normalizeWorkerPlan(workers: BlackboardWorkerPlanInput[]): BlackboardWorkerPlanInput[] {
        const unique: BlackboardWorkerPlanInput[] = [];
        const seen = new Set<string>();
        for (const worker of workers) {
            if (seen.has(worker.role)) {
                continue;
            }
            seen.add(worker.role);
            unique.push(worker);
            if (unique.length >= MAX_ROUTE_WORKERS) {
                break;
            }
        }
        if (unique.length === 0) {
            throw new Error("Blackboard route model returned no usable workers.");
        }

        const roles = new Set(unique.map((worker) => worker.role));
        const withKnownDependencies = unique.map((worker) => ({
            ...worker,
            dependsOn: (worker.dependsOn ?? []).filter((dependency) => roles.has(dependency) && dependency !== worker.role),
        }));
        return this.sortWorkersByDependencies(withKnownDependencies);
    }

    private sortWorkersByDependencies(workers: BlackboardWorkerPlanInput[]): BlackboardWorkerPlanInput[] {
        const pending = new Map(workers.map((worker) => [worker.role, worker]));
        const emitted = new Set<string>();
        const sorted: BlackboardWorkerPlanInput[] = [];

        while (pending.size > 0) {
            const ready = [...pending.values()].find((worker) =>
                (worker.dependsOn ?? []).every((dependency) => emitted.has(dependency)),
            );
            if (!ready) {
                sorted.push(...pending.values());
                break;
            }
            sorted.push(ready);
            emitted.add(ready.role);
            pending.delete(ready.role);
        }

        return sorted;
    }

    private normalizeWorkerRole(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_.-]+/gu, "-")
            .replace(/^-+|-+$/gu, "")
            .slice(0, 64);
    }

    private humanizeRole(role: string): string {
        return role
            .split(/[-_.]+/u)
            .filter(Boolean)
            .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
            .join(" ");
    }

    private readHandoff(value: unknown): BlackboardWorkerPlanInput["handoff"] | undefined {
        if (
            value === "analysis" ||
            value === "implementation" ||
            value === "proposal" ||
            value === "review" ||
            value === "structure" ||
            value === "summary" ||
            value === "verification"
        ) {
            return value;
        }
        return undefined;
    }
}

const defaultRoute = new RuntimeBlackboardRouteComponent();

export async function decideBlackboardRoute(
    model: ModelClient,
    request: string,
): Promise<RuntimeBlackboardRouteDecision> {
    return defaultRoute.decideBlackboardRoute(model, request);
}

export function parseBlackboardRouteDecision(raw: string): RuntimeBlackboardRouteDecision {
    return defaultRoute.parseBlackboardRouteDecision(raw);
}
