import { existsSync, readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['.'];
const missing: string[] = [];
const promptFiles = [
    ...filesUnder('prompts').filter((file) => file.endsWith('.md') || file.endsWith('.json')),
    ...filesUnder(join('.config', 'agents', 'flyflor')).filter((file) => file.endsWith('.md')),
];
const bannedPromptTerms = [
    /\bFlyflor\b/i,
    /\bCallosum\b/,
    /\bSynapse\b/,
    /\bCortex\b/,
    /\bIntelligence\b/,
    /\bFTool\b/,
    /\bprotocol package\b/i,
    /\bprotocol-package\b/i,
    /\bruntime code\b/i,
    /\bruntime prompt\b/i,
    /\bresearch loop\b/i,
    /\bresearch turn\b/i,
    /\broute output\b/i,
    /\baction surface\b/i,
    /\bprovider replay\b/i,
    /\bwire protocol\b/i,
    /协议包/,
    /运行时代码/,
    /运行时提示词/,
    /研究循环/,
    /路由输出/,
    /动作面/,
    /线协议/,
];
const bannedHits: string[] = [];

for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
        if (!file.endsWith('.md') || file.endsWith('.zh.cn.md') || file === 'cache.context.md') continue;
        const mirror = file.replace(/\.md$/, '.zh.cn.md');
        if (!existsSync(mirror)) missing.push(mirror);
    }
}

for (const file of promptFiles) {
    const content = readFileSync(file, 'utf-8');
    for (const term of bannedPromptTerms) {
        if (term.test(content)) bannedHits.push(`${file}: ${term}`);
    }
}

if (missing.length > 0) {
    console.error(`Missing zh.cn mirrors:\n${missing.join('\n')}`);
    process.exit(1);
}

if (bannedHits.length > 0) {
    console.error(`Banned prompt terms:\n${bannedHits.join('\n')}`);
    process.exit(1);
}

function filesUnder(root: string): string[] {
    if (!existsSync(root)) return [];
    return [...walk(root)];
}

function* walk(root: string): Generator<string> {
    for (const entry of readdirSync(root)) {
        if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
        const path = join(root, entry);
        if (statSync(path).isDirectory()) yield* walk(path);
        else yield path;
    }
}
