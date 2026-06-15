import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Research, type ResearchSignal } from './service';
import { Memory } from '@/agent/memory';
import { ConfigComponent } from '@/config';

/**
 * Live research-loop test. Requires DEEPSEEK_API_KEY and hits the real provider, per the project's
 * no-mock discipline. It proves the native function-calling round-trip drives the loop end to end:
 * the model requests a read-only tool, the loop feeds the result back, and it terminates with an answer.
 */
describe('research loop (live)', () => {
    test('investigates a file question by calling a tool and answering', async () => {
        const config = await useContainer().getAsync(ConfigComponent);
        const agentConfig = config.agents[config.agent]!;
        agentConfig.model = agentConfig.model || config.model.model || config.model.default;
        agentConfig.provider = agentConfig.provider || config.model.provider;

        const memory = await useContainer().getAsync(Memory, agentConfig);
        const research = await useContainer().getAsync(Research);

        const signals: ResearchSignal[] = [];
        const messages = memory.buildMessage('Read package.json in the Flyflor repo and tell me the value of the "name" field. Use the read_file tool.');
        const outcome = await research.run(messages, (signal) => signals.push(signal));

        const toolStarts = signals.filter((signal) => signal.type === 'tool_start');
        expect(toolStarts.length).toBeGreaterThan(0);
        expect(outcome.steps).toBeLessThanOrEqual(12);
        expect(outcome.answer.toLowerCase()).toContain('flyflor');
    }, 60000);
});
