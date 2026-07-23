/**
 * EN: Logger severity levels.
 * ZH: 日志严重级别。
 *
 * EN: Values are stable lowercase protocol strings so config files, IPC messages, and file logs can compare
 * them without translation.
 * ZH: 这些值是稳定的小写协议字符串，配置文件、IPC 消息和日志文件都可以直接比较而无需转换。
 */
export enum LoggerLevel {
    Debug = 'debug',
    Info = 'info',
    Warn = 'warn',
    Error = 'error',
}

/**
 * EN: Runtime logger configuration.
 * ZH: 运行时日志配置。
 *
 * EN: `consoleEnabled` toggles terminal output; `path` is the repo-relative or absolute append-only log file
 * path; `colorEnabled` controls ANSI colors in console output; `level` filters records below the configured
 * severity; `inspectDepth` controls how deeply JS objects and JSON-shaped objects are expanded.
 * ZH: `consoleEnabled` 控制终端输出；`path` 是相对仓库根或绝对的只追加日志路径；`colorEnabled` 控制控制台 ANSI 颜色；`level` 过滤低于当前严重级别的记录；`inspectDepth` 控制 JS 对象和 JSON 形态对象的展开深度。
 */
export interface LoggerConfiguration {
    /** EN: Whether log records are written to the terminal. ZH: 日志记录是否写入终端。 */
    consoleEnabled: boolean;
    /** EN: Repo-relative or absolute append-only log file path. ZH: 相对仓库根或绝对的只追加日志文件路径。 */
    path: string;
    /** EN: Whether console output uses ANSI colors. ZH: 控制台输出是否使用 ANSI 颜色。 */
    colorEnabled: boolean;
    /** EN: Minimum severity emitted; lower records are dropped. ZH: 最低输出严重级别，低于该级别的记录会被丢弃。 */
    level: LoggerLevel;
    /** EN: Expansion depth for inspected JS/JSON-shaped objects. ZH: 检视 JS/JSON 形态对象时的展开深度。 */
    inspectDepth: number;
}

/**
 * EN: Partial configuration accepted by `configureLogger()`, `useLogger()`, and `@Logger()`.
 * ZH: `configureLogger()`、`useLogger()` 和 `@Logger()` 接受的部分配置。
 *
 * EN: Missing fields inherit from the current runtime logger configuration.
 * ZH: 缺失字段会继承当前运行时日志配置。
 */
export interface LoggerConfigurationInput {
    /** EN: Optional override for terminal output. ZH: 可选的终端输出覆盖项。 */
    consoleEnabled?: boolean;
    /** EN: Optional override for the log file path. ZH: 可选的日志文件路径覆盖项。 */
    path?: string;
    /** EN: Optional override for ANSI color output. ZH: 可选的 ANSI 颜色输出覆盖项。 */
    colorEnabled?: boolean;
    /** EN: Optional override for the severity threshold. ZH: 可选的严重级别阈值覆盖项。 */
    level?: LoggerLevel;
    /** EN: Optional override for the object inspection depth. ZH: 可选的对象检视深度覆盖项。 */
    inspectDepth?: number;
}

/**
 * EN: Logger API returned by `useLogger()` and injected by `@Logger()`.
 * ZH: `useLogger()` 返回、`@Logger()` 注入的日志 API。
 *
 * EN: Every method accepts variadic `props` because callers may pass plain strings, errors, JS objects,
 * arrays, or JSON-like records without pre-serializing them.
 * ZH: 每个方法都接受可变参数 `props`，因为调用方可以直接传字符串、错误、JS 对象、数组或类 JSON 记录，而不必先序列化。
 */
export interface FLogger {
    /** EN: Emits one debug-level record. ZH: 输出一条 debug 级别记录。 */
    debug(...props: unknown[]): void;
    /** EN: Emits one info-level record. ZH: 输出一条 info 级别记录。 */
    info(...props: unknown[]): void;
    /** EN: Emits one warn-level record. ZH: 输出一条 warn 级别记录。 */
    warn(...props: unknown[]): void;
    /** EN: Emits one error-level record. ZH: 输出一条 error 级别记录。 */
    error(...props: unknown[]): void;
}

/**
 * EN: Options used when creating a scoped logger.
 * ZH: 创建作用域日志器时使用的选项。
 *
 * EN: `scope` is the module/component name shown in every record; `configuration` overrides runtime defaults
 * for this logger instance only.
 * ZH: `scope` 是每条记录里展示的模块/组件名；`configuration` 只覆盖这个 logger 实例的运行时默认值。
 */
export interface LoggerOptions {
    /** EN: Module/component name shown in every record header. ZH: 每条记录头部展示的模块/组件名。 */
    scope?: string;
    /** EN: Per-logger overrides on top of the runtime defaults. ZH: 仅作用于当前 logger 实例的运行时默认值覆盖项。 */
    configuration?: LoggerConfigurationInput;
}
