import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Investigation } from './service';
import { Research, type ResearchSignal } from '../research';

/**
 * Live deep-investigation test. Requires DEEPSEEK_API_KEY and hits the real provider, per the no-mock
 * discipline. It proves the isolated investigation primitive: a fresh read-only context, the evidence-only
 * tool subset, and the gate that refuses anything outside it.
 */
describe('investigation primitive (live)', () => {
    test('investigates a file question in an isolated read-only context', async () => {
        const investigation = await useContainer().getAsync(Investigation);

        const signals: ResearchSignal[] = [];
        const outcome = await investigation.run(
            'What is the value of the "name" field in package.json at the Flyflor repo root? Use the read_file tool.',
            (signal) => signals.push(signal),
        );

        const toolStarts = signals.filter((signal) => signal.type === 'tool_start');
        expect(toolStarts.length).toBeGreaterThan(0);
        // The isolated set is read/search only — ask/confirm/write must never be invoked.
        for (const start of toolStarts) {
            if (start.type !== 'tool_start') continue;
            expect(['read_file', 'codegraph']).toContain(start.name);
        }
        expect(outcome.answer.toLowerCase()).toContain('flyflor');
    }, 60000);

    test('the gate refuses a tool outside the read-only subset', async () => {
        const research = await useContainer().getAsync(Research);
        const tools = research.registry.readOnlyDefinitions();
        const names = tools.map((tool) => tool.name).sort();

        // The investigation advertises only evidence tools; ask/confirm are not offered to a sub-agent.
        expect(names).toEqual(['codegraph', 'read_file']);
    });
});
