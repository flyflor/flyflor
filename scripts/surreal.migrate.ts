/**
 * SurrealDB 历史表重命名迁移：crystal_skill → gem, skill_snapshot → gem_snapshot。
 *
 * 背景：
 *   早期 v0.x 版本使用 crystal_skill / skill_snapshot 命名；当前 schema 已统一为 gem / gem_snapshot
 *   （见 src/neural/memory/surreal.graph.ts 与 src/crystal/memory/surreal.ts）。
 *   本脚本把旧表数据搬到新表，并写入 audit 标记，原表保留只读避免误删。
 *
 * 用法：
 *   bun run scripts/surreal.migrate.ts \
 *     --url ws://127.0.0.1:8000/rpc \
 *     --namespace flyflor --database flyflor \
 *     --user root --pass root [--dry-run]
 *
 * 设计原则：
 *   - 幂等：每条记录写入新表前先 SELECT，已存在跳过；
 *   - 不破坏旧表：只读不删，迁移完成后由人工执行 `REMOVE TABLE crystal_skill;` 收尾；
 *   - 失败可恢复：每条记录独立事务，失败的记录写入 stderr，不阻塞后续；
 *   - 全量统计：stdout 输出 JSON 报表（已迁/已存在/失败/总数）。
 *
 * 退出码：0 = 成功（含已存在跳过）；1 = 任意一条失败。
 */
import { parseArgs } from "node:util";

interface SurrealRecord {
    id: string;
    [field: string]: unknown;
}

interface SurrealRpcResponse<T> {
    id?: string | number;
    result?: Array<{ result?: T; status?: string; time?: string }>;
    error?: { code: number; message: string };
}

interface MigrationStats {
    table: string;
    target: string;
    total: number;
    migrated: number;
    skipped: number;
    failed: number;
    failures: Array<{ id: string; error: string }>;
}

const TABLE_PAIRS: Array<{ from: string; to: string }> = [
    { from: "crystal_skill", to: "gem" },
    { from: "skill_snapshot", to: "gem_snapshot" },
];

async function main(): Promise<void> {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            url: { type: "string", default: "http://127.0.0.1:8000/sql" },
            namespace: { type: "string", default: "flyflor" },
            database: { type: "string", default: "flyflor" },
            user: { type: "string", default: "root" },
            pass: { type: "string", default: "root" },
            "dry-run": { type: "boolean", default: false },
        },
    });

    const auth = `Basic ${Buffer.from(`${values.user}:${values.pass}`).toString("base64")}`;
    const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: auth,
        NS: values.namespace!,
        DB: values.database!,
    };

    const allStats: MigrationStats[] = [];
    let anyFailure = false;

    for (const pair of TABLE_PAIRS) {
        const stats: MigrationStats = {
            table: pair.from,
            target: pair.to,
            total: 0,
            migrated: 0,
            skipped: 0,
            failed: 0,
            failures: [],
        };

        const rows = await runQuery<SurrealRecord[]>(
            values.url!,
            headers,
            `SELECT * FROM ${pair.from};`,
        );
        if (rows === undefined) {
            // table doesn't exist → nothing to migrate; report and continue
            allStats.push(stats);
            continue;
        }

        stats.total = rows.length;

        for (const row of rows) {
            const newId = row.id.replace(`${pair.from}:`, `${pair.to}:`);
            try {
                const existing = await runQuery<SurrealRecord[]>(values.url!, headers, `SELECT id FROM ${newId};`);
                if (existing && existing.length > 0) {
                    stats.skipped += 1;
                    continue;
                }
                if (values["dry-run"]) {
                    stats.migrated += 1;
                    continue;
                }
                const payload = { ...row };
                delete (payload as { id?: string }).id;
                (payload as Record<string, unknown>).migratedFrom = row.id;
                (payload as Record<string, unknown>).migratedAt = new Date().toISOString();
                const escaped = JSON.stringify(payload).replace(/\\/g, "\\\\");
                await runQuery<unknown>(
                    values.url!,
                    headers,
                    `CREATE ${newId} CONTENT ${escaped};`,
                );
                stats.migrated += 1;
            } catch (err) {
                stats.failed += 1;
                stats.failures.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
                anyFailure = true;
            }
        }

        allStats.push(stats);
    }

    console.log(JSON.stringify({ dryRun: values["dry-run"], stats: allStats }, null, 2));
    if (anyFailure) {
        process.exit(1);
    }
}

async function runQuery<T>(url: string, headers: Record<string, string>, sql: string): Promise<T | undefined> {
    const response = await fetch(url, { method: "POST", headers, body: sql });
    if (!response.ok) {
        throw new Error(`SurrealDB HTTP ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as Array<{ result?: T; status?: string; detail?: string }>;
    const first = payload[0];
    if (!first) return undefined;
    if (first.status && first.status.toLowerCase() !== "ok") {
        throw new Error(first.detail ?? `query failed: ${sql}`);
    }
    return first.result;
}

main().catch((err) => {
    console.error(`[surreal.migrate] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
});
