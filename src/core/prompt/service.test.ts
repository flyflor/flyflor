import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PromptService } from './service';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PromptService', () => {
    test('loads an ordered read-only package and ignores human mirrors', () => {
        const root = mkdtempSync(join(tmpdir(), 'flyflor-prompts-'));
        roots.push(root);
        writeFileSync(join(root, 'config.jsonc'), JSON.stringify({ version: 1, description: 'test', prompt: { sections: ['IDENTITY', 'RULES'] } }));
        writeFileSync(join(root, 'IDENTITY.md'), 'identity');
        writeFileSync(join(root, 'IDENTITY.zh.cn.md'), '镜像');
        writeFileSync(join(root, 'RULES.md'), 'rules');

        const service = new PromptService(root);

        expect(service.render({ kind: 'sections' })).toBe('identity\n\nrules');
        expect(service.section('IDENTITY')).toBe('identity');
        expect(service.section('IDENTITY.zh.cn')).toBe('');
    });

    test('loads one prompt file as plain text', () => {
        const root = mkdtempSync(join(tmpdir(), 'flyflor-prompt-file-'));
        roots.push(root);
        const file = join(root, 'RULES.md');
        writeFileSync(file, 'one rule');

        expect(new PromptService(file).data).toBe('one rule');
    });
});
