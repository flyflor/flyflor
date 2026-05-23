import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { FlyflorPaths } from "../../config/index.ts";
import { LocalCrystalRepo } from "../../entities/crystal/index.ts";
import type { CrystalGem } from "../../protocol/contracts/index.ts";
import type { SocketQueryCrystalInput } from "./types.ts";

/**
 * Direct crystal.db reader for socket query snapshots.
 *
 * Crystal recall can use richer vector search inside cognitive runtime; this
 * socket reader only lists persisted gems for TUI browse/debug surfaces.
 */
export class SocketCrystalReader {
    private database?: Database;
    private repo?: LocalCrystalRepo;

    public constructor(private readonly paths: FlyflorPaths) {}

    public listGems(input: SocketQueryCrystalInput): CrystalGem[] {
        const repo = this.openRepo();
        if (!repo) return [];
        return repo
            .listGems()
            .filter((gem) => input.bucket === undefined || gem.bucket === input.bucket)
            .slice(0, Math.max(1, Math.min(200, Math.floor(input.limit ?? 50))));
    }

    public dispose(): void {
        this.database?.close();
        this.database = undefined;
        this.repo = undefined;
    }

    private openRepo(): LocalCrystalRepo | undefined {
        if (this.repo) return this.repo;
        const dbPath = join(this.paths.storageDir, "crystal", "crystal.db");
        if (!existsSync(dbPath)) return undefined;
        this.database = new Database(dbPath, { readonly: true });
        this.repo = new LocalCrystalRepo(this.database);
        return this.repo;
    }
}
