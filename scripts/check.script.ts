import { existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['.', 'docs', 'prompts'];
const missing: string[] = [];

for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
        if (!file.endsWith('.md') || file.endsWith('.zh.cn.md')) continue;
        const mirror = file.replace(/\.md$/, '.zh.cn.md');
        if (!existsSync(mirror)) missing.push(mirror);
    }
}

if (missing.length > 0) {
    console.error(`Missing zh.cn mirrors:\n${missing.join('\n')}`);
    process.exit(1);
}

function* walk(root: string): Generator<string> {
    for (const entry of readdirSync(root)) {
        if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
        const path = join(root, entry);
        if (statSync(path).isDirectory()) yield* walk(path);
        else yield path;
    }
}
