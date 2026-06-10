export interface PlanStep {
    step: string;
    status?: 'pending' | 'in_progress' | 'completed';
}
