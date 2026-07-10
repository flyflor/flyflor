import { existsSync, readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const roots = ['.', 'docs', 'prompts'];
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
const architectureErrors: string[] = [];

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

checkDirectories();
checkBarrels();
checkDependencies();
checkConstruction();

if (missing.length > 0) {
    console.error(`Missing zh.cn mirrors:\n${missing.join('\n')}`);
    process.exit(1);
}

if (bannedHits.length > 0) {
    console.error(`Banned prompt terms:\n${bannedHits.join('\n')}`);
    process.exit(1);
}

if (architectureErrors.length > 0) {
    console.error(`Architecture violations:\n${architectureErrors.join('\n')}`);
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

function checkDirectories(): void {
    const expected = new Set(['agent', 'app', 'config', 'core', 'model', 'neural', 'prompt', 'tool', 'transport']);
    for (const entry of readdirSync('src')) {
        const path = join('src', entry);
        if (!statSync(path).isDirectory()) continue;
        if (!expected.has(entry)) architectureErrors.push(`src/${entry}: unexpected top-level directory`);
    }
    for (const directory of directoriesUnder('src')) {
        const name = directory.split(sep).at(-1)!;
        if (!/^[a-z]+$/.test(name)) architectureErrors.push(`${directory}: directory names must be one lowercase word`);
    }
}

function checkBarrels(): void {
    for (const file of filesUnder('src').filter((path) => path.endsWith(`${sep}index.ts`) || path === 'src/index.ts')) {
        const lines = readFileSync(file, 'utf-8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.some((line) => !line.startsWith('export '))) architectureErrors.push(`${file}: index.ts must be barrel-only`);
    }
}

function checkDependencies(): void {
    const allowed: Record<string, Set<string>> = {
        app: new Set(['app', 'core', 'neural']),
        core: new Set(['core', 'config', 'prompt']),
        config: new Set(['config', 'core']),
        prompt: new Set(['prompt', 'core']),
        model: new Set(['model', 'config', 'core']),
        tool: new Set(['tool', 'config', 'core', 'prompt']),
        agent: new Set(['agent', 'config', 'core', 'model', 'prompt', 'tool']),
        transport: new Set(['transport', 'config', 'core']),
        neural: new Set(['neural', 'agent', 'config', 'core', 'prompt', 'transport']),
    };
    const importPattern = /(?:from\s*|import\s*\()['"]@\/([^/'"]+)/g;
    for (const file of filesUnder('src').filter((path) => path.endsWith('.ts'))) {
        const owner = relative('src', file).split(sep)[0]!;
        for (const match of readFileSync(file, 'utf-8').matchAll(importPattern)) {
            const dependency = match[1]!;
            if (!allowed[owner]?.has(dependency)) architectureErrors.push(`${file}: ${owner} must not depend on ${dependency}`);
        }
    }
}

function checkConstruction(): void {
    const native = new Set(['Array', 'Buffer', 'Date', 'Error', 'Map', 'Promise', 'ReadableStream', 'Set', 'TextDecoder', 'URL']);
    const pattern = /\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;
    for (const file of filesUnder('src').filter((path) => path.endsWith('.ts'))) {
        if (file === join('src', 'core', 'ioc', 'container.ts')) continue;
        const content = readFileSync(file, 'utf-8');
        const local = new Set([...content.matchAll(/\bclass\s+([A-Z][A-Za-z0-9_]*)/g)].map((match) => match[1]!));
        for (const match of content.matchAll(pattern)) {
            if (!native.has(match[1]!) && !local.has(match[1]!)) architectureErrors.push(`${file}: application classes must be constructed by IOC (${match[1]})`);
        }
    }
}

function* directoriesUnder(root: string): Generator<string> {
    for (const entry of readdirSync(root)) {
        if (entry.startsWith('.')) continue;
        const path = join(root, entry);
        if (!statSync(path).isDirectory()) continue;
        yield path;
        yield* directoriesUnder(path);
    }
}
