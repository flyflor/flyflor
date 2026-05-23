import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * LF-R4 process-restart continuation：用 sentinel 文件追踪正在处理中的请求。
 *
 * 写入：handleMessage 入口落 `${storageDir}/inflight/<requestId>.json`，记录最少够还原 continuation 的结构化字段。
 * 移除：handleMessage 退出（成功或抛错）的 finally 里删除。
 * 恢复：runtime.warmup 调 `recoverOrphans()`，扫遗留文件 → 由调用方写 process-restart continuation → 清理。
 *
 * 触发条件全部来自结构化字段（文件存在与否、JSON payload），不消费对话文本语义 → 不违反零字符匹配红线。
 */
export interface InFlightRecord {
    requestId: string;
    sourceKey: string;
    sourceSurface: string;
    originalUserMessage: string;
    startedAtMs: number;
    codenameId?: string;
}

export class InFlightTracker {
    private readonly dir: string;
    public constructor(storageDir: string) {
        this.dir = join(storageDir, "inflight");
    }

    private fileFor(requestId: string): string {
        const safe = requestId.replace(/[^a-zA-Z0-9_.-]/g, "_");
        return join(this.dir, `${safe}.json`);
    }

    public async markStart(record: InFlightRecord): Promise<void> {
        await mkdir(this.dir, { recursive: true });
        const path = this.fileFor(record.requestId);
        await writeFile(path, JSON.stringify(record), "utf8");
    }

    public async markEnd(requestId: string): Promise<void> {
        await unlink(this.fileFor(requestId)).catch((error) => {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
            throw error;
        });
    }

    public async recoverOrphans(): Promise<InFlightRecord[]> {
        await mkdir(this.dir, { recursive: true });
        const entries = await readdir(this.dir);
        const out: InFlightRecord[] = [];
        for (const name of entries) {
            if (!name.endsWith(".json")) continue;
            const path = join(this.dir, name);
            const text = await readFile(path, "utf8");
            const parsed = JSON.parse(text) as InFlightRecord;
            if (
                parsed &&
                typeof parsed.requestId === "string" &&
                typeof parsed.sourceKey === "string" &&
                typeof parsed.sourceSurface === "string" &&
                typeof parsed.originalUserMessage === "string" &&
                typeof parsed.startedAtMs === "number"
            ) {
                out.push(parsed);
            } else {
                throw new Error(`Malformed inflight record: ${path}`);
            }
            await unlink(path);
        }
        return out;
    }
}
