import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { LOGGER_RECORD_SEPARATOR } from './constants';
import { type LoggerConfiguration } from './types';
import { stripLoggerColors } from './format';

/**
 * Emits one formatted log record to the configured sinks.
 * @param level - console method name to use when terminal output is enabled.
 * @param record - formatted record, possibly containing ANSI colors for console output.
 * @param configuration - resolved logger configuration containing console switch and file path.
 */
export function writeLogRecord(level: 'debug' | 'info' | 'warn' | 'error', record: string, configuration: LoggerConfiguration): void {
    if (configuration.consoleEnabled) {
        console[level](record);
    }
    writeFileRecord(record, configuration);
}

/**
 * Appends one plain-text log record to the configured file path.
 * @param record - formatted record, possibly containing ANSI colors.
 * @param configuration - resolved logger configuration containing the target file path.
 */
function writeFileRecord(record: string, configuration: LoggerConfiguration): void {
    if (configuration.path.length === 0) {
        throw Object.assign(Error('Logger path is empty'), { detail: { configuration } });
    }
    const path = isAbsolute(configuration.path) ? configuration.path : resolve(process.cwd(), configuration.path);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, stripLoggerColors(record) + LOGGER_RECORD_SEPARATOR, 'utf8');
}
