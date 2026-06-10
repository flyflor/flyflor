import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';
import type { PlanStep } from './types';

@Tool()
export class PlanTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'plan',
        title: 'Update plan',
        description: 'Record a compact execution plan or update current plan state.',
        capability: 'control.plan',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                objective: { type: 'string' },
                steps: { type: 'array', items: { type: 'object' } },
            },
        },
    };

    public async execute(input: unknown, _context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        const objective = typeof payload.objective === 'string' ? payload.objective : '';
        const steps = Array.isArray(payload.steps) ? payload.steps.filter(isPlanStep) : [];
        const summary = steps.length > 0 ? `Plan updated with ${steps.length} step(s)` : 'Plan noted';
        return this.success(summary, { objective, steps }, this.render(objective, steps));
    }

    private render(objective: string, steps: PlanStep[]): string {
        const lines = objective.length > 0 ? [`Objective: ${objective}`] : [];
        lines.push(...steps.map((item, index) => `${index + 1}. [${item.status ?? 'pending'}] ${item.step}`));
        return lines.join('\n');
    }
}

function isPlanStep(value: unknown): value is PlanStep {
    return typeof value === 'object' && value !== null && typeof (value as PlanStep).step === 'string';
}
