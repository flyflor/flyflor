import { existsSync, readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

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
    /\bThalamus\b/,
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
const architectureFiles = [
    ...filesUnder('src').filter((file) => file.endsWith('.ts')),
    ...filesUnder('prompts').filter((file) => file.endsWith('.md')),
    'README.md',
    'README.zh.cn.md',
].filter(existsSync);
const bannedArchitectureTerms = [
    /\bMasterContext\b/,
    /\bMemoryRepo\b/,
    /\bmemories\b/,
    /session-level situation model/i,
    /会话级情境模型/,
    /entities\/memory/,
];
const architectureHits: string[] = [];

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

for (const file of architectureFiles) {
    const content = readFileSync(file, 'utf-8');
    for (const term of bannedArchitectureTerms) {
        if (term.test(content)) architectureHits.push(`${file}: ${term}`);
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

if (architectureHits.length > 0) {
    console.error(`Legacy architecture terms:\n${architectureHits.join('\n')}`);
    process.exit(1);
}

// Code style gate: instance fields must be assigned in the constructor, and every
// public class member plus every exported interface/type-literal member must carry JSDoc.
const codeViolations: string[] = [];
const codeFiles = filesUnder('src').filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));

for (const file of codeFiles) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
    checkNode(source, source, file, codeViolations);
}

if (codeViolations.length > 0) {
    console.error(`Code style violations:\n${codeViolations.join('\n')}`);
    process.exit(1);
}

function checkNode(node: ts.Node, source: ts.SourceFile, file: string, out: string[]): void {
    if (ts.isPropertyDeclaration(node) && node.initializer !== undefined) {
        const isStatic = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false;
        const isInjected = (ts.getDecorators(node)?.length ?? 0) > 0;
        const isFunctionProperty = ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer);
        if (!isStatic && !isInjected && !isFunctionProperty) {
            out.push(`${file}:${lineOf(source, node)} field '${memberName(node)}' initializes at declaration; assign it in the constructor`);
        }
    }
    if (isPublicClassMember(node) && !hasJsDoc(source, node) && !isDocumentedImplementation(source, node)) {
        out.push(`${file}:${lineOf(source, node)} public member '${memberName(node)}' is missing a JSDoc comment`);
    }
    if (ts.isInterfaceDeclaration(node) && isExported(node)) {
        for (const member of node.members) {
            if (!hasJsDoc(source, member)) out.push(`${file}:${lineOf(source, member)} exported interface member '${memberName(member)}' is missing a JSDoc comment`);
        }
    }
    if (ts.isTypeAliasDeclaration(node) && isExported(node) && ts.isTypeLiteralNode(node.type)) {
        for (const member of node.type.members) {
            if (!hasJsDoc(source, member)) out.push(`${file}:${lineOf(source, member)} exported type member '${memberName(member)}' is missing a JSDoc comment`);
        }
    }
    ts.forEachChild(node, (child) => checkNode(child, source, file, out));
}

function isPublicClassMember(node: ts.Node): node is ts.PropertyDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration {
    if (!ts.isPropertyDeclaration(node) && !ts.isMethodDeclaration(node) && !ts.isGetAccessorDeclaration(node) && !ts.isSetAccessorDeclaration(node)) return false;
    if (!ts.isClassLike(node.parent)) return false;
    if (node.name !== undefined && ts.isPrivateIdentifier(node.name)) return false;
    const modifiers = node.modifiers?.map((modifier) => modifier.kind) ?? [];
    return !modifiers.includes(ts.SyntaxKind.PrivateKeyword) && !modifiers.includes(ts.SyntaxKind.ProtectedKeyword);
}

function isDocumentedImplementation(source: ts.SourceFile, node: ts.Node): boolean {
    if (!ts.isMethodDeclaration(node) || node.body === undefined || !ts.isClassLike(node.parent)) return false;
    return node.parent.members.some(
        (member) =>
            member !== node &&
            ts.isMethodDeclaration(member) &&
            member.body === undefined &&
            member.name.getText(source) === node.name.getText(source) &&
            hasJsDoc(source, member),
    );
}

function isExported(node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): boolean {
    return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasJsDoc(source: ts.SourceFile, node: ts.Node): boolean {
    const text = source.getFullText();
    const named = node as ts.Node & { name?: ts.Node };
    const end = named.name !== undefined ? named.name.getStart(source) : node.getStart(source);
    return /\/\*\*[\s\S]*?\*\//.test(text.slice(node.getFullStart(), end));
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function memberName(node: ts.Node): string {
    const named = node as ts.Node & { name?: ts.Node };
    return named.name !== undefined ? named.name.getText() : '<anonymous>';
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
