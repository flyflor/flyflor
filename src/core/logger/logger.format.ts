import { inspect } from 'node:util';
import {
    LOGGER_ANSI_PATTERN,
    LOGGER_COLOR,
    LOGGER_INSPECT_BREAK_LENGTH,
    LOGGER_LAYOUT,
    LOGGER_LEVEL_COLOR,
    LOGGER_LEVEL_LABEL_WIDTH,
} from './logger.constants';
import { LoggerLevel, type LoggerConfiguration } from './logger.types';

/**
 * Formats one log record for terminal output.
 * @param level - severity level for color and label rendering.
 * @param scope - component or module name shown in the header.
 * @param props - user-supplied values, including strings, errors, JS objects, arrays, and JSON-like records.
 * @param configuration - resolved logger configuration controlling color and object inspection.
 * @returns a compact, readable, optionally colored multiline log record.
 */
export function formatLogRecord(level: LoggerLevel, scope: string, props: unknown[], configuration: LoggerConfiguration): string {
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
 * Removes ANSI terminal colors from a formatted record.
 * @param value - formatted log record.
 * @returns the same record without ANSI escape sequences.
 */
export function stripLoggerColors(value: string): string {
    return value.replace(LOGGER_ANSI_PATTERN, LOGGER_LAYOUT.emptyBody);
}

/**
 * Formats one user-supplied log property.
 * @param prop - any value passed to `.debug(...props)` or sibling methods.
 * @param configuration - resolved logger configuration controlling object inspection.
 * @returns display-ready text for this property.
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
