import type { ActionRequest, ToolRunResult } from '@/plugins';

export interface ActionObservation {
    request: ActionRequest;
    result: ToolRunResult;
    evidence: string;
}
