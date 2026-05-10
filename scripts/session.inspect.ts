import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { loadConfig } from "../src/config/index.ts";
import { SQLiteMemoryStore } from "../src/neural/memory/index.ts";
import { SessionModule } from "../src/agent/session/index.ts";

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
const sessionKey = args.get("session");
const dbPath = args.get("db");

if (dbPath) {
    await inspectDatabase(dbPath, sessionKey, limit);
} else if (sessionKey) {
    const config = await loadConfig();
    const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
    const session = new SessionModule(store, config.memory.session);
    const messages = await session.timeline(sessionKey, limit);
    printMessages(sessionKey, messages);
} else {
    const config = await loadConfig();
    const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
    const session = new SessionModule(store, config.memory.session);
    const sessions = await session.list(limit);
    console.table(
        sessions.map((session) => ({
            key: session.key,
            channel: session.channel,
            chatId: session.chatId,
            threadId: session.threadId ?? "",
            userId: session.userId,
            live: session.liveMessageCount,
            total: session.totalMessageCount,
            updatedAt: session.updatedAt,
        })),
    );
}

async function inspectDatabase(path: string, session: string | undefined, limit: number): Promise<void> {
    if (!existsSync(path)) {
        console.log(`No session database found at ${path}`);
        return;
    }

    const db = new Database(path, { readonly: true });
    db.exec("PRAGMA busy_timeout = 5000");
    try {
        if (session) {
            const messages = (await readWithRetry(() =>
                db
                    .query(
                        `
                    SELECT sequence, role, content, created_at AS createdAt
                    FROM session_messages
                    WHERE session_key = ?
                    ORDER BY sequence DESC
                    LIMIT ?
                `,
                    )
                    .all(session, limit)
                    .toReversed(),
            )) as Array<{ content: string; createdAt: string; role: string; sequence: number }>;
            printMessages(session, messages);
            return;
        }

        const sessions = await readWithRetry(() =>
            db
                .query(
                    `
                SELECT
                    sessions.session_key AS key,
                    sessions.channel,
                    sessions.chat_id AS chatId,
                    COALESCE(sessions.thread_id, '') AS threadId,
                    sessions.user_id AS userId,
                    SUM(CASE WHEN session_messages.sequence > sessions.last_consolidated_sequence THEN 1 ELSE 0 END)
                        AS live,
                    COUNT(session_messages.id) AS total,
                    sessions.updated_at AS updatedAt
                FROM sessions
                LEFT JOIN session_messages ON session_messages.session_key = sessions.session_key
                GROUP BY sessions.session_key
                ORDER BY sessions.updated_at DESC
                LIMIT ?
            `,
                )
                .all(limit),
        );
        console.table(sessions);
    } finally {
        db.close();
    }
}

async function readWithRetry<T>(read: () => T): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return read();
        } catch (error) {
            lastError = error;
            if (!isBusySqliteError(error)) {
                throw error;
            }
            await Bun.sleep(100 * (attempt + 1));
        }
    }
    throw lastError;
}

function isBusySqliteError(error: unknown): boolean {
    return (
        error instanceof Error &&
        ("code" in error || "errno" in error) &&
        (String((error as { code?: unknown }).code ?? "").startsWith("SQLITE_BUSY") ||
            Number((error as { errno?: unknown }).errno) === 261)
    );
}

function printMessages(
    session: string,
    messages: Array<{ content: string; createdAt: string; role: string; sequence: number }>,
): void {
    console.log(`session: ${session}`);
    console.table(
        messages.map((message) => ({
            sequence: message.sequence,
            role: message.role,
            createdAt: message.createdAt,
            content: message.content,
        })),
    );
}

function numberArg(name: string, fallback: number): number {
    const raw = args.get(name);
    if (!raw) {
        return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
