import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { ToolRegistry } from './tool.registry';

function context() {
    return { callId: 'test', intent: 'test', evidenceCount: 1 };
}

describe('research tool registry', () => {
    test('advertises only research tools as provider function definitions', async () => {
        const registry = await useContainer().getAsync(ToolRegistry);
        const definitions = registry.definitions();
        const names = definitions.map((definition) => definition.name).sort();

        expect(names).toEqual(['ask', 'codegraph', 'confirm', 'read_file']);
        for (const definition of definitions) {
            expect(typeof definition.description).toBe('string');
            expect(definition.parameters).toMatchObject({ type: 'object' });
        }
    });

    test('dispatches a known tool by name and renders its data', async () => {
        const registry = await useContainer().getAsync(ToolRegistry);
        const outcome = await registry.dispatch('read_file', { path: 'package.json', maxBytes: 30 }, context());

        expect(outcome.isError).toBe(false);
        expect(outcome.content.length).toBeGreaterThan(0);
        expect(outcome.content).toContain('"path"');
    });

    test('an unknown tool name degrades to an error result instead of throwing', async () => {
        const registry = await useContainer().getAsync(ToolRegistry);
        const outcome = await registry.dispatch('write_file', {}, context());

        expect(outcome.isError).toBe(true);
        expect(outcome.content).toContain('not available');
    });

    test('a tool that throws is converted to an error result, never crashing the loop', async () => {
        const registry = await useContainer().getAsync(ToolRegistry);
        // read_file throws when the path is empty; the registry must catch it.
        const outcome = await registry.dispatch('read_file', { path: '' }, context());

        expect(outcome.isError).toBe(true);
        expect(outcome.content.length).toBeGreaterThan(0);
    });
});
