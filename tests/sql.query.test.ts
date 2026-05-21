import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { allQuery, getQuery, query, runQuery } from "../src/components/sql/index.ts";

describe("SQL query tag", () => {
    test("binds interpolated values as sqlite parameters", () => {
        const statement = query`SELECT * FROM memory_events WHERE owner_key = ${"scope:test"} AND ts >= ${123}`;

        expect(statement).toEqual({
            params: ["scope:test", 123],
            sql: "SELECT * FROM memory_events WHERE owner_key = ? AND ts >= ?",
        });
    });

    test("runs prepared statements without string-built value interpolation", () => {
        const db = new Database(":memory:");
        try {
            db.exec("CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
            runQuery(db, query`INSERT INTO sample (id, value) VALUES (${"a"}, ${"hello"})`);

            expect(getQuery<{ value: string }>(db, query`SELECT value FROM sample WHERE id = ${"a"}`)?.value).toBe(
                "hello",
            );
            expect(allQuery<{ id: string }>(db, query`SELECT id FROM sample WHERE value = ${"hello"}`)).toEqual([
                { id: "a" },
            ]);
        } finally {
            db.close();
        }
    });
});
