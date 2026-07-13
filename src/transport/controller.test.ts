import { describe, expect, test } from 'bun:test';
import { ConfigService } from '@/config';
import { useContainer } from '@/core';
import { Controller } from './controller';

describe('Controller', () => {
    test('cwd updates the shared config path and resolves relative input from the current config cwd', async () => {
        const originalPath = { ...ConfigService.path };
        try {
            ConfigService.path = { ...ConfigService.path, cwd: '/tmp/flyflor-root' };
            const controller = useContainer().create(Controller);
            controller.config = useContainer().create(ConfigService);

            await controller.cwd({ path: 'workspace' });
            expect(ConfigService.path.cwd).toBe('/tmp/flyflor-root/workspace');

            await controller.cwd({ path: '/tmp/absolute-root' });
            expect(ConfigService.path.cwd).toBe('/tmp/absolute-root');
            await expect(controller.dispatch({ action: 'dispatch', data: { action: 'cwd' } })).rejects.toThrow('Unknown transport action');
            await expect(controller.cwd({ path: 42 })).rejects.toThrow('Invalid cwd transport packet');
        } finally {
            ConfigService.path = originalPath;
        }
    });
});
