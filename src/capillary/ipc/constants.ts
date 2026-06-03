/**
 * Centralizes every cross-cutting literal so business code stays free of magic strings (red line rule 5).
 *
 * Anything that would otherwise be hardcoded in more than one place — well-known relative paths,
 * reflect-metadata keys, protocol topics — lives here and is imported by name.
 */

/**
 * Canonical repo-relative locations Flyflor reads/writes at runtime.
 *
 * All paths are relative (rule 7) and resolved against `rootPath` via `resolveFromRoot()` in `paths.ts`.
 * - `configFile`: the single JSONC config file, needed to bootstrap config loading before config is known.
 * - `socketFile`: public socket endpoint for IPC on every supported platform.
 * - `promptsDir`: directory holding `<name>.md` prompt sources (the `.zh.cn.md` mirrors are never read).
 * - `sqlDir`: directory holding `NNN-*.sql` schema-init scripts.
 */
export const PATHS = {
    configFile: "./.config/config.jsonc",
    socketFile: "./flyflor.sock",
    promptsDir: "./prompts",
    sqlDir: "./sql",
} as const;

/**
 * reflect-metadata key under which a class accumulates the property names marked with `@Inject`.
 *
 * The decorator writes the key set onto the constructor; the container reads it back during resolution.
 * Kept as one shared constant so decorator and container never drift apart.
 */
export const INJECT_METADATA_KEY = "flyflor:inject";
