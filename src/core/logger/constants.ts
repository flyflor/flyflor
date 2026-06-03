import { LoggerLevel } from './types';

/** Default logger scope shown when a caller does not provide a module name. */
export const LOGGER_DEFAULT_SCOPE = 'flyflor';

/** Default repo-relative log file path used by `useLogger()` and `@Logger()`. */
export const LOGGER_DEFAULT_PATH = './.logs/flyflor.log';

/** Object inspection depth used for JS objects and parsed JSON-like values. */
export const LOGGER_DEFAULT_INSPECT_DEPTH = 6;

/** Maximum line length before object inspection prefers multiline output. */
export const LOGGER_INSPECT_BREAK_LENGTH = 96;

/** Width of the level label in the console header. */
export const LOGGER_LEVEL_LABEL_WIDTH = 5;

/** String appended to each file log record. */
export const LOGGER_RECORD_SEPARATOR = '\n';

/** Regex used to remove ANSI color escapes before writing file logs. */
export const LOGGER_ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Mapping from log level to filtering weight. */
export const LOGGER_LEVEL_WEIGHT: Record<LoggerLevel, number> = {
    [LoggerLevel.Debug]: 10,
    [LoggerLevel.Info]: 20,
    [LoggerLevel.Warn]: 30,
    [LoggerLevel.Error]: 40,
};

/** ANSI color palette used only for terminal rendering. */
export const LOGGER_COLOR = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    gray: '\x1b[90m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
};

/** Level-specific terminal colors. */
export const LOGGER_LEVEL_COLOR: Record<LoggerLevel, string> = {
    [LoggerLevel.Debug]: LOGGER_COLOR.magenta,
    [LoggerLevel.Info]: LOGGER_COLOR.green,
    [LoggerLevel.Warn]: LOGGER_COLOR.yellow,
    [LoggerLevel.Error]: LOGGER_COLOR.red,
};

/** Text fragments used by the compact pretty console layout. */
export const LOGGER_LAYOUT = {
    headerOpen: '[',
    headerClose: ']',
    separator: '  ',
    bodyPrefix: '  | ',
    emptyBody: '',
};
