import type { Database } from "bun:sqlite";

export type SqlParam = string | number | boolean | null | Uint8Array;

export interface SqlQuery {
    params: SqlParam[];
    sql: string;
}

/**
 * SQLite tagged template used by repo classes.
 *
 * Values are always bound as `?` parameters. Table and column names must stay
 * literal inside repo-owned SQL so data access cannot fall back to string-built
 * identifiers or caller-controlled SQL fragments.
 */
export function query(strings: TemplateStringsArray, ...values: SqlParam[]): SqlQuery {
    let sql = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
        sql += `?${strings[index + 1] ?? ""}`;
    }
    return { params: values, sql };
}

export function runQuery(db: Database, statement: SqlQuery): void {
    db.query(statement.sql).run(...statement.params);
}

export function getQuery<TRow>(db: Database, statement: SqlQuery): TRow | null {
    return db.query(statement.sql).get(...statement.params) as TRow | null;
}

export function allQuery<TRow>(db: Database, statement: SqlQuery): TRow[] {
    return db.query(statement.sql).all(...statement.params) as TRow[];
}
