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
    test('renders package context as stable XML with protected content', () => {
        const root = packageRoot({
            'SOUL.md': 'Name: <A&B>\nedge ]]> text',
            'AGENTS.md': 'Rules',
            'SOUL.zh.cn.md': '镜像',
            'config.jsonc': `{
                "version": 1,
                "description": "test",
                "prompt": { "sections": ["SOUL"] },
                "protocolPackage": {
                    "editable": ["SOUL.md"],
                    "locked": ["AGENTS.md"],
                    "runtimeIgnored": ["AGENTS.md", "SOUL.zh.cn.md", "config.jsonc"],
                    "context": {
                        "root": "prompt_package",
                        "blocks": [
                            { "key": "config", "tag": "document", "file": "config.jsonc", "role": "policy", "note": "a < b" },
                            { "key": "SOUL", "tag": "document", "file": "SOUL.md", "role": "assistant_notes" },
                            { "key": "AGENTS", "tag": "document", "file": "AGENTS.md", "role": "rules" }
                        ]
                    }
                }
            }`,
        });
        const service = new PromptService<'SOUL' | 'AGENTS'>(root);

        const xml = service.renderXml(service.config!.protocolPackage.context);

        expect(xml).toContain('<prompt_package path="');
        expect(xml).toContain('version="1"');
        expect(xml).toContain('<document key="config" file="config.jsonc" role="policy" writable="false" note="a &lt; b">');
        expect(xml).toContain('<document key="SOUL" file="SOUL.md" role="assistant_notes" writable="true">');
        expect(xml).toContain('<document key="AGENTS" file="AGENTS.md" role="rules" writable="false">');
        expect(xml).toContain('Name: <A&B>');
        expect(xml).toContain('edge ]]]]><![CDATA[> text');
    });

    test('rejects invalid XML names and mismatched block files', () => {
        const root = packageRoot({
            'SOUL.md': 'Name',
            'config.jsonc': `{
                "version": 1,
                "description": "test",
                "prompt": { "sections": ["SOUL"] },
                "protocolPackage": {
                    "editable": ["SOUL.md"],
                    "locked": [],
                    "runtimeIgnored": ["config.jsonc"],
                    "context": {
                        "root": "prompt_package",
                        "blocks": [{ "key": "SOUL", "tag": "document", "file": "SOUL.md" }]
                    }
                }
            }`,
        });
        const service = new PromptService<'SOUL'>(root);

        expect(() => service.renderXml({ root: 'bad tag', blocks: [] })).toThrow('Prompt XML name is invalid');
        expect(() => service.renderXml({ root: 'prompt_package', blocks: [{ key: 'SOUL', tag: 'document', file: 'USER.md' }] })).toThrow('Prompt context block file is mismatched');
    });
});

function packageRoot(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'prompt-service-'));
    roots.push(root);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content, 'utf-8');
    return root;
}
