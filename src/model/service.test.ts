import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Model } from './service';

describe('Model', () => {
    test('owns profile context capacity and reports pressure at the usable threshold', () => {
        const model = useContainer().create(Model, {
            name: 'worker',
            model: 'profile-model',
            provider: 'profile-provider',
            contextLength: 100,
            maxTokens: 20,
        });
        model.root = {
            model: {
                model: 'root-model',
                provider: 'root-provider',
                apiKeyEnv: 'MODEL_KEY',
                baseUrl: 'http://localhost',
                timeoutSeconds: 60,
            },
        } as never;

        model.initProfile();

        expect(model.config.contextLength).toBe(100);
        expect(model.config.maxTokens).toBe(20);
        expect(model.needsSummary([{ role: 'user', content: 'short' }])).toBe(false);
        expect(model.needsSummary([{ role: 'user', content: 'x'.repeat(1000) }])).toBe(true);
    });
});
