import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useContainer } from '@/core';
import { Logger } from './decorator';
import { configureLogger, getLoggerConfiguration, useLogger } from './service';
import { LoggerLevel, type FLogger } from './types';

let tempPaths: string[] = [];

/**
 * EN: tempPath function declaration.
 * ZH: tempPath function 声明。
 */
function tempPath(): string {
    const path = mkdtempSync(join(tmpdir(), 'flyflor-logger-'));
    tempPaths.push(path);
    return path;
}

/**
 * EN: resetLoggerConfiguration function declaration.
 * ZH: resetLoggerConfiguration function 声明。
 */
function resetLoggerConfiguration(): void {
    configureLogger({
        consoleEnabled: true,
        path: './.logs/flyflor.log',
        colorEnabled: true,
        level: LoggerLevel.Debug,
        inspectDepth: 6,
    });
}

afterEach(() => {
    resetLoggerConfiguration();
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('logger service', () => {
    test('configureLogger updates shared logger defaults', () => {
        const path = join(tempPath(), 'shared.log');

        const configuration = configureLogger({
            consoleEnabled: false,
            path,
            colorEnabled: false,
            level: LoggerLevel.Warn,
            inspectDepth: 2,
        });

        expect(configuration).toEqual(getLoggerConfiguration());
        expect(configuration.path).toBe(path);
        expect(configuration.level).toBe(LoggerLevel.Warn);
    });

    test('useLogger filters by level and writes plain text file records', () => {
        const path = join(tempPath(), 'level.log');
        configureLogger({
            consoleEnabled: false,
            path,
            colorEnabled: true,
            level: LoggerLevel.Warn,
        });

        const logger = useLogger('logger-test');
        logger.info('hidden');
        expect(existsSync(path)).toBe(false);

        logger.warn('visible', { value: 1 });
        const content = readFileSync(path, 'utf8');

        expect(content).toContain('[WARN ]');
        expect(content).toContain('logger-test');
        expect(content).toContain('visible');
        expect(content).toContain('value');
        expect(content).not.toContain('\x1b[');
    });

    test('@Logger injects a scoped logger through the property getter', () => {
        const path = join(tempPath(), 'decorator.log');

        /**
         * EN: DecoratedLoggerHost class declaration.
         * ZH: DecoratedLoggerHost class 声明。
         */
        class DecoratedLoggerHost {
            @Logger('decorated', {
                consoleEnabled: false,
                path,
                colorEnabled: false,
                level: LoggerLevel.Debug,
            })
            public log!: FLogger;
        }

        const host = useContainer().create(DecoratedLoggerHost);
        host.log.debug('decorator works');

        const content = readFileSync(path, 'utf8');
        expect(content).toContain('[DEBUG]');
        expect(content).toContain('decorated');
        expect(content).toContain('decorator works');
    });
});
