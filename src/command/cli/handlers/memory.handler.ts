import { FlyFlorTokens, type FlyFlor } from "../../../app.ts";
import { RetrospectiveLog } from "../../../neural/memory/index.ts";

export interface MemoryData {
    enabled: boolean;
    crystalEnabled: boolean;
    redisEnabled: boolean;
    surrealEnabled: boolean;
    sqliteEnabled: boolean;
    embeddingDimensions: number;
    storageDir: string;
    memoryDir: string;
    retrospectivePath: string;
    retrospectiveExists: boolean;
    retrospectiveEntryCount: number;
}

export async function fetchMemoryData(app: FlyFlor): Promise<MemoryData> {
    const config = app.resolve(FlyFlorTokens.Config);
    const log = new RetrospectiveLog({ projectMemoryDir: config.paths.projectMemoryDir });
    const path = log.path();
    const exists = await Bun.file(path).exists();
    const text = exists ? await log.read({}) : "";
    const entryCount = text ? (text.match(/^## /gm)?.length ?? 0) - (text.startsWith("## RETROSPECTIVE") ? 1 : 0) : 0;

    return {
        enabled: config.memory.enabled,
        crystalEnabled: config.memory.crystal.enabled,
        redisEnabled: config.memory.redis.enabled,
        surrealEnabled: config.memory.crystal.surreal.enabled,
        sqliteEnabled: config.memory.sqlite.enabled,
        embeddingDimensions: config.memory.embedding.dimensions,
        storageDir: config.paths.storageDir,
        memoryDir: config.paths.memoryDir,
        retrospectivePath: path,
        retrospectiveExists: exists,
        retrospectiveEntryCount: Math.max(entryCount, 0),
    };
}
