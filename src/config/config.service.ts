import { readFileSync } from "node:fs";
import { Component } from "../di";
import { ProjectPaths } from "../shared/path";
import { parseJsonc } from "./jsonc";
import type { FlyflorConfig } from "./config.types";

/**
 * Loads and exposes Flyflor's single local configuration file.
 *
 * @usage Inject this component anywhere runtime code needs project-root-relative configuration.
 */
@Component()
export class ConfigService {
  private readonly projectPaths: ProjectPaths;
  private readonly config: FlyflorConfig;

  public constructor(
    private readonly projectRoot = process.cwd(),
    private readonly configPath = "./.config/config.jsonc",
  ) {
    this.projectPaths = new ProjectPaths(projectRoot);
    const raw = readFileSync(this.projectPaths.resolve(configPath), "utf8");
    this.config = parseJsonc(raw) as FlyflorConfig;
  }

  /**
   * Returns the parsed local configuration object.
   *
   * @returns Full `FlyflorConfig` value.
   * @usage Call this for stable config sections instead of reading files directly.
   */
  public getConfig(): FlyflorConfig {
    return this.config;
  }

  /**
   * Returns the absolute project root owned by this config service.
   *
   * @returns Absolute project root path.
   * @usage Runtime and tools use this as the default working directory.
   */
  public getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Resolves a project-relative path using the config path guard.
   *
   * @param relativePath - Project-relative path.
   * @returns Absolute path under project root.
   * @usage Use before reading any configured local file.
   */
  public resolve(relativePath: string): string {
    return this.projectPaths.resolve(relativePath);
  }

  /**
   * Ensures the parent directory for a configured file path exists.
   *
   * @param relativePath - Project-relative file path.
   * @returns Absolute file path.
   * @usage Use before writing DBs, artifacts, projections, or test pages.
   */
  public ensureFileParent(relativePath: string): string {
    return this.projectPaths.ensureFileParent(relativePath);
  }

  /**
   * Ensures a configured directory path exists.
   *
   * @param relativePath - Project-relative directory path.
   * @returns Absolute directory path.
   * @usage Use for `.config` local data directories.
   */
  public ensureDir(relativePath: string): string {
    return this.projectPaths.ensureDir(relativePath);
  }
}
