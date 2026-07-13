import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureLogger, LoggerLevel } from '@/core';

configureLogger({
    consoleEnabled: false,
    path: join(tmpdir(), 'flyflor-tests', `${process.pid}.log`),
    colorEnabled: false,
    level: LoggerLevel.Debug,
    inspectDepth: 6,
});
