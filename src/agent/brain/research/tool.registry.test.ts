import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useContainer } from '@/core';
import { ToolRegistry } from './tool.registry';

function context(root: string) {
    return {
        callId: 'call_read',
        intent: 'read_file',
        evidenceCount: 1,
        workingDirectory: root,
    };
}

describe('ToolRegistry', () => {
    test('projects tool descriptions from runtime prompt resources', async () => {
        const registry = await useContainer().getAsync(ToolRegistry);

        const readFile = registry.definitions().find((tool) => tool.name === 'read_file');

        expect(readFile?.description).toContain('Read one bounded page');
        const properties = readFile?.parameters.properties as Record<string, { description?: string }> | undefined;
        expect(properties?.path?.description).toContain('Use user-provided absolute paths directly');
    });

    test('dispatch returns bounded model content and structured preview for read_file', async () => {
        const registry = await useContainer().getAsync(ToolRegistry);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-tool-registry-'));
        const longFile = join(root, 'README.md');
        writeFileSync(longFile, `${'alpha\n'.repeat(5000)}summary: done`, 'utf-8');

        const result = await registry.dispatch('read_file', { path: longFile, maxBytes: 40000, limitLines: 5001 }, context(root));

        expect(result.isError).toBe(false);
        expect(result.content.length).toBeLessThanOrEqual(17000);
        expect(result.content).toContain('read_file result for');
        expect(result.content).toContain('middle content omitted');
        expect(result.preview.name).toBe('read_file');
        expect(result.preview.kind).toBe('summary');
        expect(result.preview.status).toBe('ok');
        expect(result.preview.preview.length).toBeLessThanOrEqual(4000);
        expect(result.preview.artifactId).toBe('call_read:read_file');
        expect(result.artifact?.id).toBe('call_read:read_file');
        expect(registry.artifact('call_read:read_file')?.content).toContain('summary: done');
    });

    test('dispatch does not put full read_file artifacts into model content', async () => {
        const registry = await useContainer().getAsync(ToolRegistry);
        const root = mkdtempSync(join(tmpdir(), 'flyflor-tool-registry-artifact-'));
        const source = join(root, 'large.txt');
        writeFileSync(source, `${'visible\n'.repeat(210)}artifact-only-tail`, 'utf-8');

        const result = await registry.dispatch('read_file', { path: source }, context(root));

        expect(result.isError).toBe(false);
        expect(result.content).not.toContain('artifact-only-tail');
        expect(result.artifact?.content).toContain('artifact-only-tail');
    });
});
