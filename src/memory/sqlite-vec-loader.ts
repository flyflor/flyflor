import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { arch, platform, tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ConfigService } from "../config/config.service";
import sqliteDarwinX64 from "../../.config/sqlite-vec/sqlite-darwin-x64/libsqlite3.dylib" with { type: "file" };
import vecDarwinArm64 from "../../.config/sqlite-vec/sqlite-vec-darwin-arm64/vec0.dylib" with { type: "file" };
import vecDarwinX64 from "../../.config/sqlite-vec/sqlite-vec-darwin-x64/vec0.dylib" with { type: "file" };
import vecLinuxArm64 from "../../.config/sqlite-vec/sqlite-vec-linux-arm64/vec0.so" with { type: "file" };
import vecLinuxX64 from "../../.config/sqlite-vec/sqlite-vec-linux-x64/vec0.so" with { type: "file" };
import vecWindowsX64 from "../../.config/sqlite-vec/sqlite-vec-windows-x64/vec0.dll" with { type: "file" };

/**
 * Loads sqlite-vec from vendored dynamic libraries.
 *
 * @usage MemoryComponent calls this before creating vector tables.
 */
export class SqliteVecLoader {
  private static customSqlitePrepared = false;

  public constructor(private readonly configService = new ConfigService()) {}

  /**
   * Prepares Bun SQLite before any database handle is created.
   *
   * @returns Nothing.
   * @usage On macOS x64 Bun must use the vendored SQLite dylib before `new Database()`.
   */
  public prepare(): void {
    if (platform() !== "darwin" || arch() !== "x64" || SqliteVecLoader.customSqlitePrepared) {
      return;
    }
    const sqlitePath = this.materializeAssetFile(sqliteDarwinX64, "sqlite-darwin-x64/libsqlite3.dylib");
    try {
      Database.setCustomSQLite(sqlitePath);
      SqliteVecLoader.customSqlitePrepared = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("SQLite already loaded")) {
        SqliteVecLoader.customSqlitePrepared = true;
        return;
      }
      throw error;
    }
  }

  /**
   * Loads sqlite-vec into an open Bun SQLite database.
   *
   * @param db - Open Bun SQLite database.
   * @returns Whether sqlite-vec was loaded successfully.
   * @usage Tests can continue with fallback lexical recall if local extension loading is unavailable.
   */
  public load(db: Database): boolean {
    try {
      const vecPath = this.materializeAssetFile(this.vendorVecAssetPath(), this.vendorVecPath());
      db.loadExtension(vecPath, "sqlite3_vec_init");
      return true;
    } catch (error) {
      console.warn(`[memory] sqlite-vec unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Returns the platform-specific vendored sqlite-vec asset path.
   *
   * @returns Relative path under `.config/sqlite-vec`.
   * @usage Internal helper for dynamic extension loading.
   */
  private vendorVecPath(): string {
    const key = `${platform()}-${arch()}`;
    switch (key) {
      case "darwin-x64":
        return "sqlite-vec-darwin-x64/vec0.dylib";
      case "darwin-arm64":
        return "sqlite-vec-darwin-arm64/vec0.dylib";
      case "linux-x64":
        return "sqlite-vec-linux-x64/vec0.so";
      case "linux-arm64":
        return "sqlite-vec-linux-arm64/vec0.so";
      case "win32-x64":
        return "sqlite-vec-windows-x64/vec0.dll";
      default:
        throw new Error(`Unsupported sqlite-vec platform: ${key}`);
    }
  }

  /**
   * Returns the statically imported sqlite-vec asset for the active platform.
   *
   * @returns Bun file asset path string.
   * @usage Static imports let `bun build --compile` embed dynamic libraries.
   */
  private vendorVecAssetPath(): string {
    const key = `${platform()}-${arch()}`;
    switch (key) {
      case "darwin-x64":
        return vecDarwinX64;
      case "darwin-arm64":
        return vecDarwinArm64;
      case "linux-x64":
        return vecLinuxX64;
      case "linux-arm64":
        return vecLinuxArm64;
      case "win32-x64":
        return vecWindowsX64;
      default:
        throw new Error(`Unsupported sqlite-vec platform: ${key}`);
    }
  }

  /**
   * Materializes a vendored file to a real runtime path.
   *
   * @param source - Bun file asset path produced by static import.
   * @param vendorRelativePath - Vendor-relative path used for stable runtime materialization.
   * @returns Absolute real filesystem path.
   * @usage SQLite extensions require a real path rather than a virtual Bun asset path.
   */
  private materializeAssetFile(source: string, vendorRelativePath: string): string {
    const outDir = join(tmpdir(), "flyflor-sqlite-vec", vendorRelativePath.replaceAll("/", "-"));
    const outPath = join(outDir, basename(vendorRelativePath));
    mkdirSync(outDir, { recursive: true });
    if (!existsSync(outPath)) {
      writeFileSync(outPath, readFileSync(source));
    }
    return outPath;
  }
}
