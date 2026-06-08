import { describe, expect, test } from 'bun:test';
import { FileService, Prompt, useContainer } from '@/core';

class AgentPromptHost {
    public name = 'flyflor';

    @Prompt('agent', function wrapper(this: AgentPromptHost) {
        return this.name;
    })
    public prompts!: FileService<{ SOUL: string; config: { name: string } }> & {
        SOUL: FileService<string>;
        config: FileService<{ name: string }>;
    };

    @Prompt('agent/config.jsonc', function wrapper(this: AgentPromptHost) {
        return this.name;
    })
    public config!: FileService<{ name: string }>;
}

describe('@Prompt', () => {
    test('loads an agent package subpath', () => {
        const host = useContainer().create(AgentPromptHost);

        expect(host.config.path.endsWith('/.config/agents/flyflor/config.jsonc')).toBe(true);
        expect(host.config.data.name).toBe('flyflor');
    });

    test('packages an agent prompt root with markdown shortcuts and config metadata', () => {
        const host = useContainer().create(AgentPromptHost);

        expect(host.prompts.path.endsWith('/.config/agents/flyflor')).toBe(true);
        expect(host.prompts.SOUL.data).toContain('FlyFlor');
        expect(host.prompts.config.data.name).toBe('flyflor');
    });
});
