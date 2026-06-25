import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { inspect } from 'node:util';
import {
    LOGGER_ANSI_PATTERN,
    LOGGER_COLOR,
    LOGGER_DEFAULT_INSPECT_DEPTH,
    LOGGER_DEFAULT_PATH,
    LOGGER_DEFAULT_SCOPE,
    LOGGER_INSPECT_BREAK_LENGTH,
    LOGGER_LAYOUT,
    LOGGER_LEVEL_COLOR,
    LOGGER_LEVEL_LABEL_WIDTH,
    LOGGER_LEVEL_WEIGHT,
    LOGGER_RECORD_SEPARATOR,
} from './constants';
import { LoggerLevel, type FLogger, type LoggerConfiguration, type LoggerConfigurationInput, type LoggerOptions } from './types';

/**
 * EN: Logger is a compact core utility, not a domain service.
 * ZH: Logger 是一个紧凑的核心工具，不是业务服务。
 *
 * EN: The public surface stays intentionally small: create a scoped logger, configure shared defaults, and inspect
 * the active configuration. Formatting and writing stay private so logger behavior is easy to read without jumping
 * through several one-function modules.
 * ZH: 公开面保持刻意精简：创建作用域 logger、配置共享默认值、查看当前配置。格式化和写入保持私有，让 logger 行为不必在多个单函数模块之间来回跳转。
 */
let currentConfiguration: LoggerConfiguration = {
    consoleEnabled: true,
    path: LOGGER_DEFAULT_PATH,
    colorEnabled: true,
    level: LoggerLevel.Debug,
    inspectDepth: LOGGER_DEFAULT_INSPECT_DEPTH,
};

/**
 * EN: Creates a scoped logger API.
 * ZH: 创建一个作用域 logger API。
 *
 * EN: `scopeOrOptions` may be a scope name or options object; the scope appears in every log header.
 * `configuration` overrides defaults when the first argument is a scope string.
 * ZH: `scopeOrOptions` 可以是作用域名或选项对象；作用域会出现在每条日志头部。第一个参数是作用域字符串时，`configuration` 可覆盖默认值。
 */
export function useLogger(scopeOrOptions: string | LoggerOptions = LOGGER_DEFAULT_SCOPE, configuration?: LoggerConfigurationInput): FLogger {
    const scope = typeof scopeOrOptions === 'string' ? scopeOrOptions : scopeOrOptions.scope ?? LOGGER_DEFAULT_SCOPE;
    const resolvedConfiguration = resolveLoggerConfiguration(typeof scopeOrOptions === 'string' ? configuration : scopeOrOptions.configuration);
    return {
        debug: (...props: unknown[]) => log(LoggerLevel.Debug, scope, props, resolvedConfiguration),
        info: (...props: unknown[]) => log(LoggerLevel.Info, scope, props, resolvedConfiguration),
        warn: (...props: unknown[]) => log(LoggerLevel.Warn, scope, props, resolvedConfiguration),
        error: (...props: unknown[]) => log(LoggerLevel.Error, scope, props, resolvedConfiguration),
    };
}

/**
 * EN: Updates the shared logger configuration used by subsequently created loggers.
 * ZH: 更新后续新建 logger 使用的共享配置。
 *
 * EN: `configuration` is usually adapted from the app config.
 * ZH: `configuration` 通常来自应用配置。
 */
export function configureLogger(configuration: LoggerConfigurationInput): LoggerConfiguration {
    currentConfiguration = resolveLoggerConfiguration(configuration);
    return currentConfiguration;
}

/**
 * EN: Returns the active shared logger configuration.
 * ZH: 返回当前生效的共享 logger 配置。
 */
export function getLoggerConfiguration(): LoggerConfiguration {
    return currentConfiguration;
}

/**
 * EN: Merges overrides with the current shared logger configuration.
 * ZH: 把覆盖项合并进当前共享 logger 配置。
 */
function resolveLoggerConfiguration(configuration: LoggerConfigurationInput = {}): LoggerConfiguration {
    return {
        consoleEnabled: configuration.consoleEnabled ?? currentConfiguration.consoleEnabled,
        path: configuration.path ?? currentConfiguration.path,
        colorEnabled: configuration.colorEnabled ?? currentConfiguration.colorEnabled,
        level: configuration.level ?? currentConfiguration.level,
        inspectDepth: configuration.inspectDepth ?? currentConfiguration.inspectDepth,
    };
}

/**
 * EN: Emits one log record when the level passes the configured threshold.
 * ZH: 当级别高于阈值时输出一条日志记录。
 */
function log(level: LoggerLevel, scope: string, props: unknown[], configuration: LoggerConfiguration): void {
    if (LOGGER_LEVEL_WEIGHT[level] < LOGGER_LEVEL_WEIGHT[configuration.level]) {
        return;
    }
    writeLogRecord(level, formatLogRecord(level, scope, props, configuration), configuration);
}

/**
 * EN: Formats one complete log record.
 * ZH: 格式化一条完整日志记录。
 */
function formatLogRecord(level: LoggerLevel, scope: string, props: unknown[], configuration: LoggerConfiguration): string {
    const color = configuration.colorEnabled ? LOGGER_LEVEL_COLOR[level] : LOGGER_LAYOUT.emptyBody;
    const reset = configuration.colorEnabled ? LOGGER_COLOR.reset : LOGGER_LAYOUT.emptyBody;
    const dim = configuration.colorEnabled ? LOGGER_COLOR.dim : LOGGER_LAYOUT.emptyBody;
    const cyan = configuration.colorEnabled ? LOGGER_COLOR.cyan : LOGGER_LAYOUT.emptyBody;
    const levelLabel = level.toUpperCase().padEnd(LOGGER_LEVEL_LABEL_WIDTH);
    const header = [
        `${LOGGER_LAYOUT.headerOpen}${color}${levelLabel}${reset}${LOGGER_LAYOUT.headerClose}`,
        `${dim}${new Date().toISOString()}${reset}`,
        `${cyan}${scope}${reset}`,
    ].join(LOGGER_LAYOUT.separator);
    const body = props.map((prop) => formatProp(prop, configuration)).join('\n').split('\n').map((line) => LOGGER_LAYOUT.bodyPrefix + line).join('\n');
    if (body.length === 0) {
        return header;
    }
    return header + '\n' + body;
}

/**
 * EN: Formats one log argument into text.
 * ZH: 把单个日志参数格式化成文本。
 */
function formatProp(prop: unknown, configuration: LoggerConfiguration): string {
    if (typeof prop === 'string') {
        return prop;
    }
    if (prop instanceof Error) {
        return prop.stack ?? prop.message;
    }
    return inspect(prop, {
        colors: configuration.colorEnabled,
        depth: configuration.inspectDepth,
        compact: false,
        breakLength: LOGGER_INSPECT_BREAK_LENGTH,
        sorted: true,
    });
}

/**
 * EN: Writes one log record to console and/or file.
 * ZH: 将一条日志记录写入控制台和/或文件。
 */
function writeLogRecord(level: LoggerLevel, record: string, configuration: LoggerConfiguration): void {
    if (configuration.consoleEnabled) {
        console[level](record);
    }
    writeFileRecord(record, configuration);
}

/**
 * EN: Appends one log record to the configured file.
 * ZH: 把一条日志记录追加到配置文件。
 */
function writeFileRecord(record: string, configuration: LoggerConfiguration): void {
    if (configuration.path.length === 0) {
        throw Object.assign(Error('Logger path is empty'), { detail: { configuration } });
    }
    const path = isAbsolute(configuration.path) ? configuration.path : resolve(process.cwd(), configuration.path);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, stripLoggerColors(record) + LOGGER_RECORD_SEPARATOR, 'utf8');
}

/**
 * EN: Removes ANSI color codes from a log record.
 * ZH: 从日志记录中移除 ANSI 颜色码。
 */
function stripLoggerColors(value: string): string {
    return value.replace(LOGGER_ANSI_PATTERN, LOGGER_LAYOUT.emptyBody);
}
