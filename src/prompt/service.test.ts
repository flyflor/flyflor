import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptService } from './service';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PromptService', () => {
    test('loads canonical markdown by filename convention', () => {
        const root = packageRoot({
            'SOUL.md': 'soul-body',
            'SOUL.zh.cn.md': '镜像',
            'USER.md': '  user-body  ',
            'config.jsonc': '{"ignored":true}',
        });
        const service = new PromptService<'SOUL' | 'USER'>(root);

        expect(service.render({ sections: ['SOUL', 'USER'] })).toBe('soul-body\n\nuser-body');
        expect(service.section('SOUL')).toBe('soul-body');
        expect(Object.keys(service.data)).toEqual(['SOUL', 'USER']);
    });

    test('writes an explicitly selected prompt file', () => {
        const root = packageRoot({ 'SOUL.md': 'before' });
        const service = new PromptService<'SOUL'>(root);
        const soul = service.data.SOUL!;

        soul.set('after');

        expect(soul.data).toBe('after');
    });
});

function packageRoot(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'prompt-service-'));
    roots.push(root);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content, 'utf-8');
    return root;
}
