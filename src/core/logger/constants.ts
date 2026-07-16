import { LoggerLevel } from './types';

/** ZH: 调用方未提供模块名时的默认 logger scope。 EN: Default logger scope when a caller omits a module name. */
export const LOGGER_DEFAULT_SCOPE = 'flyflor';

/** ZH: useLogger 与 @Logger 使用的默认仓库相对日志路径。 EN: Default repo-relative log file path for useLogger and @Logger. */
export const LOGGER_DEFAULT_PATH = './.logs/flyflor.log';

/** ZH: JS 对象与类 JSON 值的 inspect 深度。 EN: Object inspection depth for JS objects and JSON-like values. */
export const LOGGER_DEFAULT_INSPECT_DEPTH = 6;

/** ZH: 超过该行长后 object inspection 优先多行输出。 EN: Line length before object inspection prefers multiline output. */
export const LOGGER_INSPECT_BREAK_LENGTH = 96;

/** ZH: 控制台 header 中 level 标签的固定宽度。 EN: Fixed width of the level label in the console header. */
export const LOGGER_LEVEL_LABEL_WIDTH = 5;

/** ZH: 每条文件日志记录后追加的分隔符。 EN: Separator appended after each file log record. */
export const LOGGER_RECORD_SEPARATOR = '\n';

/** ZH: 写入文件前剥离 ANSI 颜色转义的正则。 EN: Regex stripping ANSI color escapes before file writes. */
export const LOGGER_ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** ZH: 日志级别到过滤权重的映射。 EN: Mapping from log level to filtering weight. */
export const LOGGER_LEVEL_WEIGHT: Record<LoggerLevel, number> = {
    [LoggerLevel.Debug]: 10,
    [LoggerLevel.Info]: 20,
    [LoggerLevel.Warn]: 30,
    [LoggerLevel.Error]: 40,
};

/** ZH: 仅用于终端渲染的 ANSI 调色板。 EN: ANSI color palette used only for terminal rendering. */
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

/** ZH: 按级别区分的终端颜色。 EN: Level-specific terminal colors. */
export const LOGGER_LEVEL_COLOR: Record<LoggerLevel, string> = {
    [LoggerLevel.Debug]: LOGGER_COLOR.magenta,
    [LoggerLevel.Info]: LOGGER_COLOR.green,
    [LoggerLevel.Warn]: LOGGER_COLOR.yellow,
    [LoggerLevel.Error]: LOGGER_COLOR.red,
};

/** ZH: 紧凑控制台布局使用的文本片段。 EN: Text fragments for the compact pretty console layout. */
export const LOGGER_LAYOUT = {
    headerOpen: '[',
    headerClose: ']',
    separator: '  ',
    bodyPrefix: '  | ',
    emptyBody: '',
};
