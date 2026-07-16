import { existsSync, readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import ts from 'typescript';

const roots = ['.', 'docs', 'prompts'];
const missing: string[] = [];
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
const DECORATORS = new Set(['Module', 'Provide', 'Singleton', 'Inject', 'Scope', 'Init', 'Config', 'Prompt']);
const INJECTED_PROPERTIES = new Set(['Inject', 'Scope', 'Config', 'Prompt']);
const OBSERVABLE_METHODS = new Set(['pipe', 'switch', 'subscribe', 'next']);

if (import.meta.main) run();

/** ZH: 一次性执行全部仓库架构门禁。 EN: Executes all repository architecture gates once. */
function run(): void {
    const promptFiles = [
        ...filesUnder('prompts').filter((file) => file.endsWith('.md') || file.endsWith('.json')),
        ...filesUnder(join('.config', 'agents', 'flyflor')).filter((file) => file.endsWith('.md')),
    ];
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
    checkTypeScript();

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
        const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
        if (!barrelOnly(source)) architectureErrors.push(`${file}: index.ts must contain only re-export declarations`);
    }
    const neural = readFileSync(join('src', 'neural', 'index.ts'), 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (neural.length !== 1 || !/^export \* from ['"]\.\/synapse['"];?$/.test(neural[0]!)) {
        architectureErrors.push('src/neural/index.ts: Neural barrel must expose only Synapse');
    }
}

function checkDependencies(): void {
    const allowed: Record<string, Set<string>> = {
        app: new Set(['app', 'core', 'neural']),
        bootstrap: new Set(['app', 'core']),
        core: new Set(['core', 'config', 'prompt']),
        config: new Set(['config', 'core']),
        prompt: new Set(['prompt', 'core']),
        model: new Set(['model', 'config', 'core']),
        tool: new Set(['tool', 'config', 'core', 'prompt']),
        agent: new Set(['agent', 'config', 'core', 'model', 'prompt', 'tool']),
        transport: new Set(['transport', 'config', 'core']),
        neural: new Set(['neural', 'agent', 'config', 'core', 'prompt', 'transport']),
    };
    for (const file of filesUnder('src').filter((path) => path.endsWith('.ts'))) {
        const root = relative('src', file).split(sep)[0]!;
        const owner = root.endsWith('.ts') ? root.slice(0, -3) : root;
        const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
        for (const specifier of moduleSpecifiers(source)) {
            if (specifier.startsWith('@/')) {
                const dependency = specifier.slice(2).split('/')[0]!;
                if (!allowed[owner]?.has(dependency)) architectureErrors.push(`${file}: ${owner} must not depend on ${dependency}`);
            }
        }
    }
}

function checkConstruction(): void {
    const native = new Set(['Array', 'Buffer', 'Date', 'Error', 'Map', 'Promise', 'ReadableStream', 'Response', 'Set', 'TextDecoder', 'URL']);
    for (const file of filesUnder('src').filter((path) => path.endsWith('.ts'))) {
        if (file === join('src', 'core', 'ioc', 'container.ts')) continue;
        const content = readFileSync(file, 'utf-8');
        const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
        const local = new Set(source.statements.filter(ts.isClassDeclaration).map((node) => node.name?.text).filter((name): name is string => name !== undefined));
        source.forEachChild(function visit(node): void {
            if (ts.isNewExpression(node)) {
                if (!ts.isIdentifier(node.expression)) architectureErrors.push(`${file}: dynamic constructors must remain inside IOC`);
                else {
                    const name = node.expression.text;
                    if (!native.has(name) && !local.has(name)) architectureErrors.push(`${file}: application classes must be constructed by IOC (${name})`);
                }
            }
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
                && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Reflect'
                && node.expression.name.text === 'construct') {
                architectureErrors.push(`${file}: Reflect.construct must remain inside IOC`);
            }
            node.forEachChild(visit);
        });
    }
}

function checkTypeScript(): void {
    const files = [...filesUnder('src'), ...filesUnder('scripts'), ...filesUnder('web')].filter((file) => file.endsWith('.ts'));
    for (const file of files) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
        architectureErrors.push(...sourceViolations(file, source));
        if (!file.startsWith(join('src', 'agent', 'context'))) {
            for (const statement of source.statements.filter(ts.isImportDeclaration)) {
                const path = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
                const turnImport = statement.importClause?.namedBindings;
                if (path.includes('agent/context/entity') || (turnImport && ts.isNamedImports(turnImport) && turnImport.elements.some((element) => element.name.text === 'Turn'))) {
                    architectureErrors.push(`${file}: Turn must remain private to Context`);
                }
            }
        }
    }
}

function sourceViolations(file: string, source: ts.SourceFile): string[] {
    const errors: string[] = [];
    const runtime = !file.endsWith('.test.ts') && file.startsWith(`src${sep}`);
    if (runtime) errors.push(...relativeImportViolations(file, source));
    source.forEachChild(function visit(node): void {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (ts.isPropertyDeclaration(node) && node.initializer && !hasModifier(node, ts.SyntaxKind.StaticKeyword)) {
            errors.push(`${file}:${line}: instance properties must initialize in constructor`);
        }
        if (ts.isCatchClause(node)) errors.push(`${file}:${line}: CatchClause is forbidden`);
        if (ts.isVoidExpression(node)) errors.push(`${file}:${line}: discarded async work is forbidden`);
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            if (node.expression.name.text === 'catch') errors.push(`${file}:${line}: .catch() is forbidden`);
            if (node.expression.name.text === 'then' && node.arguments.length > 1) errors.push(`${file}:${line}: rejection fallback handler is forbidden`);
        }
        if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name?.text === 'Session') {
            errors.push(`${file}: Session type is forbidden`);
        }
        if (runtime) {
            for (const decorator of decoratorsOf(node)) {
                const name = decoratorName(decorator);
                if (!name || !DECORATORS.has(name)) errors.push(`${file}:${line}: decorator is not allowed (${name ?? 'dynamic'})`);
            }
        }
        if (runtime && ts.isClassDeclaration(node)) {
            checkClassDocumentation(file, source, node, errors);
            checkConstructorState(file, source, node, errors);
        }
        if (file === join('src', 'core', 'observable', 'service.ts') && ts.isClassDeclaration(node) && node.name?.text === 'Observable') {
            checkObservableSurface(file, node, errors);
        }
        node.forEachChild(visit);
    });
    return errors;
}

function relativeImportViolations(file: string, source: ts.SourceFile): string[] {
    const errors: string[] = [];
    const ownerPath = relative('src', file).split(sep)[0]!;
    const owner = ownerPath.endsWith('.ts') ? ownerPath.slice(0, -3) : ownerPath;
    for (const specifier of moduleSpecifiers(source)) {
        if (!specifier.startsWith('.')) continue;
        const targetPath = relative('src', join(dirname(file), specifier)).split(sep)[0]!;
        const dependency = targetPath.endsWith('.ts') ? targetPath.slice(0, -3) : targetPath;
        if (dependency !== owner) errors.push(`${file}: cross-domain imports must use @/* (${specifier})`);
    }
    return errors;
}

function checkClassDocumentation(file: string, source: ts.SourceFile, node: ts.ClassDeclaration, errors: string[]): void {
    if (!hasBilingualDocumentation(node, source)) errors.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: runtime class requires substantive EN/ZH JSDoc`);
    for (const member of node.members) {
        if (!ts.isConstructorDeclaration(member) && !ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member) && !ts.isSetAccessorDeclaration(member)) continue;
        const line = source.getLineAndCharacterOfPosition(member.getStart()).line + 1;
        if (!hasBilingualDocumentation(member, source)) errors.push(`${file}:${line}: runtime method requires substantive EN/ZH JSDoc`);
        const end = source.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
        if (end - line + 1 > 500) errors.push(`${file}:${line}: method exceeds 500 lines`);
    }
}

function checkConstructorState(file: string, source: ts.SourceFile, node: ts.ClassDeclaration, errors: string[]): void {
    const constructor = node.members.find(ts.isConstructorDeclaration);
    const assigned = new Set<string>();
    if (constructor?.body) {
        constructor.body.forEachChild(function visit(current): void {
            if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken
                && ts.isPropertyAccessExpression(current.left) && current.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
                assigned.add(current.left.name.text);
            }
            current.forEachChild(visit);
        });
    }
    for (const member of node.members.filter(ts.isPropertyDeclaration)) {
        if (hasModifier(member, ts.SyntaxKind.StaticKeyword) || hasModifier(member, ts.SyntaxKind.AbstractKeyword)) continue;
        if (decoratorsOf(member).some((decorator) => {
            const name = decoratorName(decorator);
            return name !== undefined && INJECTED_PROPERTIES.has(name);
        })) continue;
        if (!ts.isIdentifier(member.name)) continue;
        if (!assigned.has(member.name.text)) {
            const line = source.getLineAndCharacterOfPosition(member.getStart()).line + 1;
            errors.push(`${file}:${line}: constructor must initialize owned instance state (${member.name.text})`);
        }
    }
}

function checkObservableSurface(file: string, node: ts.ClassDeclaration, errors: string[]): void {
    const methods = node.members.filter(ts.isMethodDeclaration).filter((member) => !hasModifier(member, ts.SyntaxKind.PrivateKeyword) && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword));
    const names = methods.map((method) => ts.isIdentifier(method.name) ? method.name.text : method.name.getText());
    const exact = names.length === OBSERVABLE_METHODS.size && names.every((name) => OBSERVABLE_METHODS.has(name));
    if (!exact) errors.push(`${file}: Observable public methods must be exactly pipe, switch, subscribe, and next`);
    for (const member of node.members) {
        if ((!ts.isPropertyDeclaration(member) && !ts.isGetAccessorDeclaration(member) && !ts.isSetAccessorDeclaration(member))
            || hasModifier(member, ts.SyntaxKind.PrivateKeyword) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) continue;
        errors.push(`${file}: Observable must not expose public state or accessors (${member.name.getText()})`);
    }
}

function hasBilingualDocumentation(node: ts.Node, source: ts.SourceFile): boolean {
    const documentation = ts.getJSDocCommentsAndTags(node).map((item) => item.getText(source)).join('\n');
    return /\bEN:\s*\S/.test(documentation) && /\bZH:\s*\S/.test(documentation);
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
    if (!ts.canHaveDecorators(node)) return [];
    return ts.getDecorators(node) ?? [];
}

function decoratorName(decorator: ts.Decorator): string | undefined {
    const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
    return ts.isIdentifier(expression) ? expression.text : undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    return ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
}

function barrelOnly(source: ts.SourceFile): boolean {
    return source.statements.length > 0
        && source.statements.every((statement) => ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined);
}

function moduleSpecifiers(source: ts.SourceFile): string[] {
    const specifiers: string[] = [];
    source.forEachChild(function visit(node): void {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!)) specifiers.push(node.arguments[0].text);
        node.forEachChild(visit);
    });
    return specifiers;
}

/** ZH: 正负 checker fixture 共用的纯源码门禁。 EN: Pure source gates used by positive and negative checker fixtures. */
export const CheckRules = {
    inspect(file: string, content: string): string[] {
        const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
        const errors = sourceViolations(file, source);
        if ((file.endsWith(`${sep}index.ts`) || file === 'src/index.ts') && !barrelOnly(source)) {
            errors.push(`${file}: index.ts must contain only re-export declarations`);
        }
        return errors;
    },
};

function* directoriesUnder(root: string): Generator<string> {
    for (const entry of readdirSync(root)) {
        if (entry.startsWith('.')) continue;
        const path = join(root, entry);
        if (!statSync(path).isDirectory()) continue;
        yield path;
        yield* directoriesUnder(path);
    }
}
