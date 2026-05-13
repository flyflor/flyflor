import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * LF-R4 process-restart ghost：用 sentinel 文件追踪正在处理中的请求。
 *
 * 写入：handleMessage 入口落 `${storageDir}/inflight/<requestId>.json`，记录最少够还原 ghost 的结构化字段。
 * 移除：handleMessage 退出（成功或抛错）的 finally 里删除。
 * 恢复：runtime.warmup 调 `recoverOrphans()`，扫遗留文件 → 由调用方写 process-restart ghost → 清理。
 *
 * 触发条件全部来自结构化字段（文件存在与否、JSON payload），不消费对话文本语义 → 不违反零字符匹配红线。
 */
export interface InFlightRecord {
    requestId: string;
    userId: string;
    channelId: string;
    originalUserMessage: string;
    startedAtMs: number;
    codenameId?: string;
}

export class InFlightTracker {
    private readonly dir: string;
    constructor(storageDir: string) {
        this.dir = join(storageDir, "inflight");
    }

    private fileFor(requestId: string): string {
        const safe = requestId.replace(/[^a-zA-Z0-9_.-]/g, "_");
        return join(this.dir, `${safe}.json`);
    }

    async markStart(record: InFlightRecord): Promise<void> {
        await mkdir(this.dir, { recursive: true });
        const path = this.fileFor(record.requestId);
        await writeFile(path, JSON.stringify(record), "utf8");
    }

    async markEnd(requestId: string): Promise<void> {
        try {
            await unlink(this.fileFor(requestId));
        } catch {
            // best-effort：文件已被清理或从未写入都不阻断主流程。
        }
    }

    async recoverOrphans(): Promise<InFlightRecord[]> {
        let entries: string[];
        try {
            entries = await readdir(this.dir);
        } catch {
            return [];
        }
        const out: InFlightRecord[] = [];
        for (const name of entries) {
            if (!name.endsWith(".json")) continue;
            const path = join(this.dir, name);
            try {
                const text = await readFile(path, "utf8");
                const parsed = JSON.parse(text) as InFlightRecord;
                if (
                    parsed &&
                    typeof parsed.requestId === "string" &&
                    typeof parsed.userId === "string" &&
                    typeof parsed.channelId === "string" &&
                    typeof parsed.originalUserMessage === "string" &&
                    typeof parsed.startedAtMs === "number"
                ) {
                    out.push(parsed);
                }
            } catch {
                // 损坏文件直接跳过；下面 unlink 会清掉。
            }
            try {
                await unlink(path);
            } catch {
                // ignore
            }
        }
        return out;
    }
}
