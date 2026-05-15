import { FlyFlorTokens, type FlyFlor } from "../../../app.ts";
import { RetrospectiveLog } from "../../../neural/memory/index.ts";
import { describeWorkingMemoryHealth, describeWorkingMemoryRecoveryFiles } from "../status.ts";

export interface MemoryData {
    enabled: boolean;
    crystalEnabled: boolean;
    crystalBackend: string;
    /** 兼容外部工作记忆适配器状态；默认本地 MemoryComponent 不依赖它。 */
    redisAdapterEnabled: boolean;
    /** 兼容外部晶体图适配器状态；默认本地 CrystalComponent 不依赖它。 */
    surrealAdapterEnabled: boolean;
    sqliteEnabled: boolean;
    embeddingDimensions: number;
    crystalDbFile: string;
    storageDir: string;
    memoryDir: string;
    workingMemoryStatus: {
        status: "ok" | "warn";
        detail: string;
    };
    workingRecoveryStatus: {
        status: "ok";
        detail: string;
    };
    retrospectivePath: string;
    retrospectiveExists: boolean;
    retrospectiveEntryCount: number;
}

export async function fetchMemoryData(app: FlyFlor): Promise<MemoryData> {
    const config = app.resolve(FlyFlorTokens.Config);
    const workingMemorySnapshot = app.resolve(FlyFlorTokens.Memory).getWorkingMemoryHealthSnapshot();
    const log = new RetrospectiveLog({ projectMemoryDir: config.paths.projectMemoryDir });
    const path = log.path();
    const exists = await Bun.file(path).exists();
    const text = exists ? await log.read({}) : "";
    const entryCount = text ? (text.match(/^## /gm)?.length ?? 0) - (text.startsWith("## RETROSPECTIVE") ? 1 : 0) : 0;

    return {
        enabled: config.memory.enabled,
        crystalEnabled: config.memory.crystal.enabled,
        crystalBackend: config.memory.crystal.backend,
        redisAdapterEnabled: config.memory.redis.enabled,
        surrealAdapterEnabled: config.memory.crystal.surreal.enabled,
        sqliteEnabled: config.memory.sqlite.enabled,
        embeddingDimensions: config.memory.embedding.dimensions,
        crystalDbFile: config.memory.crystal.local.dbFile ?? "",
        storageDir: config.paths.storageDir,
        memoryDir: config.paths.memoryDir,
        workingMemoryStatus: describeWorkingMemoryHealth(workingMemorySnapshot),
        workingRecoveryStatus: await describeWorkingMemoryRecoveryFiles(config),
        retrospectivePath: path,
        retrospectiveExists: exists,
        retrospectiveEntryCount: Math.max(entryCount, 0),
    };
}
