import { LOGGER_DEFAULT_SCOPE, LOGGER_LEVEL_WEIGHT } from './constants';
import { resolveLoggerConfiguration } from './configuration';
import { formatLogRecord } from './format';
import { LoggerLevel, type LoggerApi, type LoggerConfigurationInput, type LoggerOptions } from './types';
import { writeLogRecord } from './writer';

/**
 * Creates a scoped logger API.
 * @param scopeOrOptions - optional scope name or options object; the scope appears in every log header.
 * @param configuration - optional per-logger configuration override when the first argument is a scope string.
 * @returns logger methods for debug/info/warn/error with variadic object-safe `props` formatting.
 */
export function useLogger(scopeOrOptions: string | LoggerOptions = LOGGER_DEFAULT_SCOPE, configuration?: LoggerConfigurationInput): LoggerApi {
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
 * Writes one log event if it passes the configured level threshold.
 * @param level - severity level requested by the caller.
 * @param scope - module/component scope shown in output.
 * @param props - variadic values passed by the caller, including JS objects and JSON-like records.
 * @param configuration - complete logger configuration.
 */
function log(level: LoggerLevel, scope: string, props: unknown[], configuration: ReturnType<typeof resolveLoggerConfiguration>): void {
    if (LOGGER_LEVEL_WEIGHT[level] < LOGGER_LEVEL_WEIGHT[configuration.level]) {
        return;
    }
    writeLogRecord(level, formatLogRecord(level, scope, props, configuration), configuration);
}
