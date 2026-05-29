/**
 * Declares Bun file-asset imports for SQLite dynamic libraries.
 *
 * @usage `SqliteVecLoader` imports these files with `with { type: "file" }` so Bun compile can embed them.
 */
declare module "*.dylib" {
  const path: string;
  export default path;
}

/**
 * Declares Bun file-asset imports for Linux shared objects.
 *
 * @usage `SqliteVecLoader` imports these files with `with { type: "file" }` so Bun compile can embed them.
 */
declare module "*.so" {
  const path: string;
  export default path;
}

/**
 * Declares Bun file-asset imports for Windows dynamic libraries.
 *
 * @usage `SqliteVecLoader` imports these files with `with { type: "file" }` so Bun compile can embed them.
 */
declare module "*.dll" {
  const path: string;
  export default path;
}
