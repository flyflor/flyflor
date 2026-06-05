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
 * Logger is a compact core utility, not a domain service.
 *
 * The public surface stays intentionally small: create a scoped logger, configure shared defaults, and inspect the
 * active configuration. Formatting and writing are private implementation details in this file so logger behavior is
 * easy to read without jumping through several one-function modules.
 */
let currentConfiguration: LoggerConfiguration = {
    consoleEnabled: true,
    path: LOGGER_DEFAULT_PATH,
    colorEnabled: true,
    level: LoggerLevel.Debug,
    inspectDepth: LOGGER_DEFAULT_INSPECT_DEPTH,
};

/**
 * Creates a scoped logger API.
 * @param scopeOrOptions - optional scope name or options object; the scope appears in every log header.
 * @param configuration - optional per-logger configuration override when the first argument is a scope string.
 * @returns logger methods for debug/info/warn/error with variadic object-safe `props` formatting.
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
 * Updates the shared logger configuration used by subsequently created loggers.
 * @param configuration - partial logger configuration, usually adapted from the app config.
 * @returns the resolved logger configuration after applying overrides.
 */
export function configureLogger(configuration: LoggerConfigurationInput): LoggerConfiguration {
    currentConfiguration = resolveLoggerConfiguration(configuration);
    return currentConfiguration;
}

/**
 * Returns the active shared logger configuration.
 * @returns the logger configuration currently used by new logger calls.
 */
export function getLoggerConfiguration(): LoggerConfiguration {
    return currentConfiguration;
}

function resolveLoggerConfiguration(configuration: LoggerConfigurationInput = {}): LoggerConfiguration {
    return {
        consoleEnabled: configuration.consoleEnabled ?? currentConfiguration.consoleEnabled,
        path: configuration.path ?? currentConfiguration.path,
        colorEnabled: configuration.colorEnabled ?? currentConfiguration.colorEnabled,
        level: configuration.level ?? currentConfiguration.level,
        inspectDepth: configuration.inspectDepth ?? currentConfiguration.inspectDepth,
    };
}

function log(level: LoggerLevel, scope: string, props: unknown[], configuration: LoggerConfiguration): void {
    if (LOGGER_LEVEL_WEIGHT[level] < LOGGER_LEVEL_WEIGHT[configuration.level]) {
        return;
    }
    writeLogRecord(level, formatLogRecord(level, scope, props, configuration), configuration);
}

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

function writeLogRecord(level: LoggerLevel, record: string, configuration: LoggerConfiguration): void {
    if (configuration.consoleEnabled) {
        console[level](record);
    }
    writeFileRecord(record, configuration);
}

function writeFileRecord(record: string, configuration: LoggerConfiguration): void {
    if (configuration.path.length === 0) {
        throw Object.assign(Error('Logger path is empty'), { detail: { configuration } });
    }
    const path = isAbsolute(configuration.path) ? configuration.path : resolve(process.cwd(), configuration.path);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, stripLoggerColors(record) + LOGGER_RECORD_SEPARATOR, 'utf8');
}

function stripLoggerColors(value: string): string {
    return value.replace(LOGGER_ANSI_PATTERN, LOGGER_LAYOUT.emptyBody);
}
