import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config/index.ts";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index] ?? "";
    if (!item.startsWith("--")) {
        continue;
    }
    const next = process.argv[index + 1];
    args.set(item.slice(2), next && !next.startsWith("--") ? next : "true");
}

const limit = numberArg("limit", 20);
const dbPath = args.get("db") ?? join((await loadConfig()).paths.storageDir, "blackboard", "blackboard.sqlite");
const turnId = args.get("turn");
const projectConstraintId = args.get("project-constraint-id");

if (!existsSync(dbPath)) {
    console.log(`No blackboard database found at ${dbPath}`);
    process.exit(0);
}

const db = new Database(dbPath, { readonly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
    if (turnId) {
        printTurn(turnId, limit);
    } else {
        printTurns(projectConstraintId, limit);
    }
} finally {
    db.close();
}

function printTurns(projectConstraint: string | undefined, max: number): void {
    const rows = projectConstraint
        ? db
              .query(
                  `
                  SELECT id, project_constraint_id AS projectConstraintId, status, goal, updated_at AS updatedAt
                  FROM blackboard_turns
                  WHERE project_constraint_id = ?
                  ORDER BY updated_at DESC
                  LIMIT ?
              `,
              )
              .all(projectConstraint, max)
        : db
              .query(
                  `
                  SELECT id, project_constraint_id AS projectConstraintId, status, goal, updated_at AS updatedAt
                  FROM blackboard_turns
                  ORDER BY updated_at DESC
                  LIMIT ?
              `,
              )
              .all(max);
    console.table(rows);
}

function printTurn(id: string, max: number): void {
    const turn = db
        .query(
            `
            SELECT id, project_constraint_id AS projectConstraintId, request_id AS requestId, status, goal,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM blackboard_turns
            WHERE id = ?
        `,
        )
        .get(id);
    console.log("turn");
    console.table(turn ? [turn] : []);

    const messages = db
        .query(
            `
            SELECT created_at AS createdAt, round, worker_role AS workerRole,
                   role, visibility, content
            FROM blackboard_messages
            WHERE turn_id = ?
            ORDER BY created_at ASC
            LIMIT ?
        `,
        )
        .all(id, max);
    console.log("messages");
    console.table(messages);

    const steps = db
        .query(
            `
            SELECT created_at AS createdAt, round, worker_role AS workerRole,
                   risk, output_summary AS outputSummary
            FROM blackboard_steps
            WHERE turn_id = ?
            ORDER BY round ASC, created_at ASC
            LIMIT ?
        `,
        )
        .all(id, max);
    console.log("steps");
    console.table(steps);
}

function numberArg(name: string, fallback: number): number {
    const raw = args.get(name);
    if (!raw) {
        return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
