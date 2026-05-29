import { dirname, join, normalize, resolve } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Resolves project-relative paths and creates local directories when needed.
 *
 * @param projectRoot - Absolute root directory of the current Flyflor workspace.
 * @usage Use this component whenever runtime code needs to turn config paths into filesystem paths.
 */
export class ProjectPaths {
  public constructor(private readonly projectRoot: string) {}

  /**
   * Converts a committed relative path into an absolute path under the project root.
   *
   * @param relativePath - Path from `.config/config.jsonc`, expected to be project-root relative.
   * @returns Absolute normalized path under the project root.
   * @usage Reject absolute or parent-escaping paths before reading/writing local assets.
   */
  public resolve(relativePath: string): string {
    if (relativePath.startsWith("/")) {
      throw new Error(`Absolute config paths are forbidden: ${relativePath}`);
    }
    const absolute = normalize(resolve(this.projectRoot, relativePath));
    const root = normalize(this.projectRoot);
    if (absolute !== root && !absolute.startsWith(`${root}/`)) {
      throw new Error(`Config path escapes project root: ${relativePath}`);
    }
    return absolute;
  }

  /**
   * Ensures a directory exists and returns its absolute path.
   *
   * @param relativePath - Project-relative directory path.
   * @returns Absolute directory path.
   * @usage Use for runtime-owned directories such as memory, artifacts, and sqlite-vec materialization.
   */
  public ensureDir(relativePath: string): string {
    const absolute = this.resolve(relativePath);
    mkdirSync(absolute, { recursive: true });
    return absolute;
  }

  /**
   * Ensures the parent directory for a project-relative file exists.
   *
   * @param relativePath - Project-relative file path.
   * @returns Absolute file path.
   * @usage Use before writing DB files, artifacts, and Markdown projections.
   */
  public ensureFileParent(relativePath: string): string {
    const absolute = this.resolve(relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    return absolute;
  }

  /**
   * Joins a project-relative directory and path segment.
   *
   * @param relativeDir - Project-relative directory.
   * @param segment - Child path segment.
   * @returns Absolute joined path.
   * @usage Use when writing generated files under config-owned folders.
   */
  public join(relativeDir: string, segment: string): string {
    return join(this.resolve(relativeDir), segment);
  }
}
