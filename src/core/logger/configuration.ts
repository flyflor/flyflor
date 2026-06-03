import { LOGGER_DEFAULT_INSPECT_DEPTH, LOGGER_DEFAULT_PATH } from './constants';
import { LoggerLevel, type LoggerConfiguration, type LoggerConfigurationInput } from './types';

/** Runtime logger configuration shared by `useLogger()` and `@Logger()`. */
let currentConfiguration: LoggerConfiguration = {
    consoleEnabled: true,
    path: LOGGER_DEFAULT_PATH,
    colorEnabled: true,
    level: LoggerLevel.Debug,
    inspectDepth: LOGGER_DEFAULT_INSPECT_DEPTH,
};

/**
 * Updates the shared logger configuration.
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

/**
 * Resolves an optional logger override against the active shared configuration.
 * @param configuration - optional per-call or per-decorator override.
 * @returns a complete logger configuration with no missing fields.
 */
export function resolveLoggerConfiguration(configuration: LoggerConfigurationInput = {}): LoggerConfiguration {
    return {
        consoleEnabled: configuration.consoleEnabled ?? currentConfiguration.consoleEnabled,
        path: configuration.path ?? currentConfiguration.path,
        colorEnabled: configuration.colorEnabled ?? currentConfiguration.colorEnabled,
        level: configuration.level ?? currentConfiguration.level,
        inspectDepth: configuration.inspectDepth ?? currentConfiguration.inspectDepth,
    };
}
