import { describe, expect, test } from 'bun:test';
import { ConfigService } from '@/configuration';
import { Controller } from './controller';

describe('Controller', () => {
    test('cwd updates the shared config path and resolves relative input from the current config cwd', async () => {
        const originalPath = { ...ConfigService.path };
        try {
            ConfigService.path = { ...ConfigService.path, cwd: '/tmp/flyflor-root' };
            const controller = new Controller();
            controller.config = { path: ConfigService.path } as ConfigService;

            await controller.cwd({ path: 'workspace' });
            expect(ConfigService.path.cwd).toBe('/tmp/flyflor-root/workspace');

            await controller.cwd({ path: '/tmp/absolute-root' });
            expect(ConfigService.path.cwd).toBe('/tmp/absolute-root');
        } finally {
            ConfigService.path = originalPath;
        }
    });
});
