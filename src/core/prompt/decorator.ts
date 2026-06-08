import { join } from 'path';
import { JSON5 } from 'bun';
import { isPlainObject } from 'lodash-es';
import { useContainer } from '@/core/ioc';
import { FileService } from '@/core/file/service';
import { ROOT_PATH } from '@/config';
import { FLYFLOR_PROMPT_BLOCK_PATTERN, FLYFLOR_PROMPT_NAMESPACE, PROMPT_BLOCK_ENABLED_KEY, PROMPT_BLOCK_VERSION_KEY } from './constants';
import type { PromptBlock, PromptBlockMap, PromptSource } from './types';

interface PromptParseResult {
    content: string;
    blocks: PromptBlock[];
}

interface JsoncPayload {
    raw: string;
    body: string;
}

export enum PromptScope {
    GLOBAL,
    AGENT,
}

interface PromptDecoratorConfig {
    scope: PromptScope;
    agentName?: string | ((this: any) => string);
}

/**
 * Binds a class property to a prompt file object.
 *
 * The decorated property is a loaded `FileService`, not raw text. This keeps the agent code object-oriented:
 * the agent owns a visible prompt object (`data` for prompt text, `blocks` for flyflor protocol blocks).
 */
export function Prompt(path?: string): PropertyDecorator;
export function Prompt<TThis>(path: string | undefined, agentName: string | ((this: TThis) => string)): PropertyDecorator;
export function Prompt(path?: string, scope?: PromptScope.GLOBAL): PropertyDecorator;
export function Prompt(path: string | undefined, scope: PromptScope.AGENT, agentName: string): PropertyDecorator;
export function Prompt<TThis>(path: string | undefined, scope: PromptScope.AGENT, agentName: (this: TThis) => string): PropertyDecorator;
export function Prompt(
    path?: string,
    scopeOrAgentName: PromptScope | string | ((this: any) => string) = PromptScope.GLOBAL,
    agentName?: string | ((this: any) => string),
): PropertyDecorator {
    const promptConfig = resolvePromptConfig(scopeOrAgentName, agentName);
    return (target, propertyKey) => {
        const promptStorageKey = Symbol(String(propertyKey));
        Object.defineProperty(target, propertyKey, {
            configurable: true,
            enumerable: true,
            get() {
                if (this[promptStorageKey] instanceof FileService) {
                    return this[promptStorageKey];
                }

                // The getter keeps dynamic agent names working because `this.agentConfig` exists only on the instance.
                const promptPath = resolvePromptPath(path, promptConfig, this);

                // Prompt files are path-bound objects, so each decorated property needs its own non-singleton instance.
                const prompt = useContainer().create(FileService, promptPath).reload();
                packageAgentPrompt(prompt, path, promptConfig);
                this[promptStorageKey] = prompt;
                return prompt;
            },
            set(value) {
                this[promptStorageKey] = value;
            },
        });
    };
}

function resolvePromptConfig(scopeOrAgentName: PromptScope | string | ((this: any) => string), agentName?: string | ((this: any) => string)): PromptDecoratorConfig {
    if (typeof scopeOrAgentName === 'string' || typeof scopeOrAgentName === 'function') {
        return { scope: PromptScope.AGENT, agentName: scopeOrAgentName };
    }
    return { scope: scopeOrAgentName, agentName };
}

function resolvePromptPath(path: string | undefined, config: PromptDecoratorConfig, host: any): string {
    if (config.scope === PromptScope.AGENT) {
        if (config.agentName === undefined) {
            throw Object.assign(Error('Agent prompt requires agentName'), { detail: { path, scope: config.scope } });
        }
        const resolvedAgentName = typeof config.agentName === 'function' ? config.agentName.call(host) : config.agentName;
        const agentRoot = join(ROOT_PATH, '.config/agents', resolvedAgentName);
        if (path === undefined || path === '' || path === 'agent') return agentRoot;
        if (path === 'agent/config.jsonc') return join(agentRoot, 'config.jsonc');
        if (path.startsWith('agent/')) return join(agentRoot, path.slice('agent/'.length));
        return join(agentRoot, path);
    }
    return join(ROOT_PATH, 'prompts', path || '');
}

function packageAgentPrompt(prompt: FileService<any>, path: string | undefined, config: PromptDecoratorConfig): void {
    if (config.scope !== PromptScope.AGENT || !(path === undefined || path === '' || path === 'agent')) return;
    if (!isPlainObject(prompt.data)) return;

    const blocks: PromptBlockMap = {};
    for (const [key, child] of Object.entries(prompt.children)) {
        if (typeof child.data === 'string') {
            const value = child.data;
            const parsed = parsePrompt(value, { path: join(prompt.path, `${key}.md`), key });
            child.data = parsed.content;
            (prompt.data as Record<string, unknown>)[key] = parsed.content;
            mergePromptBlocks(blocks, parsed.blocks);
        }
    }
    Object.defineProperty(prompt, 'blocks', {
        configurable: true,
        enumerable: false,
        value: blocks,
        writable: true,
    });
}

function parsePrompt(content: string, source: PromptSource): PromptParseResult {
    const blocks: PromptBlock[] = [];
    let cursor = 0;
    let output = '';

    for (const match of content.matchAll(FLYFLOR_PROMPT_BLOCK_PATTERN)) {
        const name = match[1];
        if (name === undefined || match.index === undefined) continue;

        const openStart = match.index;
        const openEnd = openStart + match[0].length;
        const closeTag = `</${FLYFLOR_PROMPT_NAMESPACE}:${name}>`;
        const closeStart = content.indexOf(closeTag, openEnd);
        if (closeStart === -1) {
            throw Object.assign(Error(`Prompt block '${name}' is missing its closing tag`), { detail: { source, block: name } });
        }

        const closeEnd = closeStart + closeTag.length;
        blocks.push(parsePromptBlock(name, content.slice(openEnd, closeStart), source));
        output += content.slice(cursor, openStart);
        cursor = closeEnd;
    }

    output += content.slice(cursor);
    return {
        content: output.replace(/\n{3,}/g, '\n\n').trim(),
        blocks,
    };
}

function mergePromptBlocks(target: PromptBlockMap, blocks: PromptBlock[]): void {
    for (const block of blocks) {
        if (block.enabled) {
            target[block.key] = block;
            continue;
        }
        delete target[block.key];
    }
}

function parsePromptBlock(name: string, rawBlock: string, source: PromptSource): PromptBlock {
    const jsonc = readJsoncPayload(rawBlock);
    if (jsonc === undefined) {
        throw Object.assign(Error(`Prompt block '${name}' must start with a JSONC object payload`), { detail: { source, block: name } });
    }

    let parsed: unknown;
    try {
        parsed = JSON5.parse(jsonc.raw);
    } catch (error) {
        throw Object.assign(Error(`Prompt block '${name}' payload is invalid JSONC`), {
            cause: error,
            detail: { source, block: name },
        });
    }

    if (!isPlainObject(parsed)) {
        throw Object.assign(Error(`Prompt block '${name}' payload must be an object`), { detail: { source, block: name } });
    }

    const payload = parsed as Record<string, unknown>;
    if (!(PROMPT_BLOCK_VERSION_KEY in payload)) {
        throw Object.assign(Error(`Prompt block '${name}' payload must include version`), { detail: { source, block: name } });
    }

    return {
        namespace: FLYFLOR_PROMPT_NAMESPACE,
        name,
        key: name,
        payload,
        body: jsonc.body.trim(),
        source,
        enabled: payload[PROMPT_BLOCK_ENABLED_KEY] !== false,
    };
}

function readJsoncPayload(rawBlock: string): JsoncPayload | undefined {
    const start = rawBlock.search(/\S/);
    if (start === -1 || rawBlock[start] !== '{') return undefined;

    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = start; index < rawBlock.length; index += 1) {
        const char = rawBlock[index];
        const next = rawBlock[index + 1];

        if (inLineComment) {
            if (char === '\n') inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === quote) {
                inString = false;
                quote = '';
            }
            continue;
        }

        if ((char === '"' || char === "'") && char !== undefined) {
            inString = true;
            quote = char;
            continue;
        }

        if (char === '/' && next === '/') {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === '/' && next === '*') {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return {
                    raw: rawBlock.slice(start, index + 1),
                    body: rawBlock.slice(index + 1),
                };
            }
        }
    }

    return undefined;
}
