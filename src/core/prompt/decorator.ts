import { join } from 'path';
import { useContainer } from '@/core/ioc';
import { FileService } from '@/core/file/service';
import { ROOT_PATH } from '@/config';

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
        return join(ROOT_PATH, '.config/agents', resolvedAgentName);
    }
    return join(ROOT_PATH, 'prompts', path || '');
}
