/**
 * Logger severity levels.
 * Values are stable lowercase protocol strings so config files, IPC messages, and file logs can compare them
 * without translation.
 */
export enum LoggerLevel {
    Debug = 'debug',
    Info = 'info',
    Warn = 'warn',
    Error = 'error',
}

/**
 * Runtime logger configuration.
 * `consoleEnabled` toggles terminal output; `path` is the repo-relative or absolute append-only log file path;
 * `colorEnabled` controls ANSI colors in console output; `level` filters records below the configured severity;
 * `inspectDepth` controls how deeply JS objects and JSON-shaped objects are expanded.
 */
export interface LoggerConfiguration {
    consoleEnabled: boolean;
    path: string;
    colorEnabled: boolean;
    level: LoggerLevel;
    inspectDepth: number;
}

/**
 * Partial configuration accepted by `configureLogger()`, `useLogger()`, and `@Logger()`.
 * Missing fields inherit from the current runtime logger configuration.
 */
export interface LoggerConfigurationInput {
    consoleEnabled?: boolean;
    path?: string;
    colorEnabled?: boolean;
    level?: LoggerLevel;
    inspectDepth?: number;
}

/**
 * Logger API returned by `useLogger()` and injected by `@Logger()`.
 * Every method accepts variadic `props` because callers may pass plain strings, errors, JS objects, arrays,
 * or JSON-like records without pre-serializing them.
 */
export interface LoggerApi {
    debug(...props: unknown[]): void;
    info(...props: unknown[]): void;
    warn(...props: unknown[]): void;
    error(...props: unknown[]): void;
}

/**
 * Options used when creating a scoped logger.
 * `scope` is the module/component name shown in every record; `configuration` overrides runtime defaults for
 * this logger instance only.
 */
export interface LoggerOptions {
    scope?: string;
    configuration?: LoggerConfigurationInput;
}
