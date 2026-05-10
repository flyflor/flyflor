import type { SurrealMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import type {
    CrystalRecallRequest,
    CrystalSkill,
    ReflectionAtom,
    ReflectionCandidate,
} from "../../protocol/contracts/index.ts";
import type { CrystalMemoryStore } from "./types.ts";

interface SurrealResponse<TValue> {
    result?: TValue;
    status?: string;
}

@Component({ name: "surreal-crystal-memory-store", tags: ["database", "crystal"] })
export class SurrealCrystalMemoryStore implements CrystalMemoryStore {
    private initialized = false;

    constructor(private readonly config: SurrealMemoryConfig) {}

    async initialize(): Promise<void> {
        if (!this.config.enabled || this.initialized) {
            return;
        }
        await this.query(
            [
                "DEFINE TABLE IF NOT EXISTS reflection_candidate SCHEMALESS;",
                "DEFINE TABLE IF NOT EXISTS reflection_atom SCHEMALESS;",
                "DEFINE TABLE IF NOT EXISTS crystal_skill SCHEMALESS;",
                "DEFINE INDEX IF NOT EXISTS crystal_skill_bucket ON crystal_skill COLUMNS bucket;",
                "DEFINE INDEX IF NOT EXISTS crystal_skill_stable_id ON crystal_skill COLUMNS stableId UNIQUE;",
            ].join("\n"),
        );
        this.initialized = true;
    }

    async findSkill(id: string): Promise<CrystalSkill | undefined> {
        if (!this.config.enabled) {
            return undefined;
        }
        await this.initialize();
        const rows = await this.query<CrystalSkill[]>(
            `SELECT * FROM crystal_skill WHERE stableId = ${literal(id)} LIMIT 1;`,
        );
        return rows[0];
    }

    async listSkills(request: CrystalRecallRequest): Promise<CrystalSkill[]> {
        if (!this.config.enabled) {
            return [];
        }
        await this.initialize();
        const buckets = request.buckets ?? [];
        const where = buckets.length > 0 ? ` WHERE bucket IN [${buckets.map(literal).join(", ")}]` : "";
        return this.query<CrystalSkill[]>(
            `SELECT * FROM crystal_skill${where} LIMIT ${Math.max(1, request.limit * 8)};`,
        );
    }

    async upsertCandidate(candidate: ReflectionCandidate): Promise<void> {
        if (!this.config.enabled) {
            return;
        }
        await this.initialize();
        await this.upsert("reflection_candidate", candidate.id, { ...candidate });
    }

    async upsertAtom(atom: ReflectionAtom): Promise<void> {
        if (!this.config.enabled) {
            return;
        }
        await this.initialize();
        await this.upsert("reflection_atom", atom.id, { ...atom });
    }

    async upsertSkill(skill: CrystalSkill): Promise<void> {
        if (!this.config.enabled) {
            return;
        }
        await this.initialize();
        await this.upsert("crystal_skill", skill.id, { ...skill, stableId: skill.id });
    }

    private async upsert(table: string, id: string, value: Record<string, unknown>): Promise<void> {
        await this.query(
            `DELETE ${table} WHERE stableId = ${literal(id)} OR id = ${literal(id)}; CREATE ${table} CONTENT ${literal({ ...value, stableId: id })};`,
        );
    }

    private async query<TValue>(sql: string): Promise<TValue> {
        const response = await fetch(new URL("/sql", this.config.internalUrl), {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/surrealql",
                "Surreal-DB": this.config.database,
                "Surreal-NS": this.config.namespace,
                ...(this.authHeader() ? { authorization: this.authHeader()! } : {}),
            },
            body: sql,
            signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        if (!response.ok) {
            throw new Error(`SurrealDB query failed: ${response.status}`);
        }
        const payload = (await response.json()) as SurrealResponse<TValue>[];
        const failed = payload.find((item) => item.status && item.status !== "OK");
        if (failed) {
            throw new Error(`SurrealDB query failed: ${JSON.stringify(failed)}`);
        }
        return (payload.at(-1)?.result ?? []) as TValue;
    }

    private authHeader(): string | undefined {
        if (!this.config.username || !this.config.password) {
            return undefined;
        }
        return `Basic ${btoa(`${String(this.config.username)}:${String(this.config.password)}`)}`;
    }
}

function literal(value: unknown): string {
    return JSON.stringify(value);
}
