import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useContainer } from '@/core';
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
        const service = useContainer().create(PromptService, root) as PromptService<'SOUL' | 'USER'>;

        expect(service.render({ kind: 'sections', sections: ['SOUL', 'USER'] })).toBe('soul-body\n\nuser-body');
        expect(service.section('SOUL')).toBe('soul-body');
        expect(Object.keys(service.data)).toEqual(['SOUL', 'USER']);
    });

    test('writes an explicitly selected prompt file', () => {
        const root = packageRoot({ 'SOUL.md': 'before' });
        const service = useContainer().create(PromptService, root) as PromptService<'SOUL'>;
        const soul = service.data.SOUL!;

        soul.set('after');

        expect(soul.data).toBe('after');
    });

    test('renders inline service XML and splits embedded CDATA terminators', () => {
        const root = packageRoot({ 'SYSTEM.md': 'system' });
        const service = useContainer().create(PromptService, root);

        const document = service.render({
            kind: 'document',
            root: 'service_context',
            attributes: { source: 'brain&memory' },
            blocks: [{ tag: 'input', content: 'a]]>b' }],
        });

        expect(document).toContain('source="brain&amp;memory"');
        expect(document).toContain('a]]]]><![CDATA[>b');
    });

    test('rejects missing document blocks and illegal XML names', () => {
        const root = packageRoot({ 'SYSTEM.md': 'system' });
        const service = useContainer().create(PromptService, root);

        expect(() => service.render({ kind: 'document', root: 'context', blocks: [] })).toThrow('requires root and blocks');
        expect(() => service.render({ kind: 'document', root: 'bad root', blocks: [{ tag: 'input', content: 'value' }] })).toThrow('XML name is invalid');
        expect(service.render({ kind: 'document' })).toContain('<prompt_package');
    });
});

function packageRoot(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'prompt-service-'));
    roots.push(root);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content, 'utf-8');
    return root;
}
