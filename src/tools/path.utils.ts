import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Describes a tool path resolved inside the active working directory.
 *
 * @property absolutePath - Absolute filesystem path used for I/O.
 * @property relativePath - Forward-slash path relative to the tool cwd.
 * @property parentDirectory - Absolute parent directory used before writes.
 * @usage File tools call `resolveToolPath` before reading or writing user-supplied paths.
 */
export interface ResolvedToolPath {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly parentDirectory: string;
}

/**
 * Resolves a tool path and rejects traversal outside the tool cwd.
 *
 * @param cwd - Tool working directory.
 * @param requestedPath - Relative or absolute path supplied by the model/runtime.
 * @returns Normalized path metadata.
 * @usage Prevents file tools from escaping the active worktree.
 */
export function resolveToolPath(cwd: string, requestedPath: string): ResolvedToolPath {
  const root = resolve(cwd);
  const absolutePath = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(root, requestedPath);
  const relativePath = normalizeRelativePath(relative(root, absolutePath));
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Path escapes tool cwd: ${requestedPath}`);
  }
  return {
    absolutePath,
    relativePath,
    parentDirectory: dirname(absolutePath),
  };
}

/**
 * Normalizes a relative path into forward-slash form.
 *
 * @param pathValue - Path returned by Node path helpers.
 * @returns Stable relative path for outputs and events.
 * @usage Tool results use this for portable artifact and file path references.
 */
export function normalizeRelativePath(pathValue: string): string {
  if (pathValue === "") {
    return ".";
  }
  return pathValue.split(sep).join("/");
}

/**
 * Checks whether a path targets the protected root config file.
 *
 * @param relativePath - Normalized project-relative path.
 * @returns True for `.config/config.jsonc`.
 * @usage Write and edit tools deny this path unless a current plan explicitly allows it.
 */
export function isProtectedConfigPath(relativePath: string): boolean {
  return relativePath === ".config/config.jsonc";
}
