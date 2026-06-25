/**
 * EN: System brief for an isolated investigation sub-agent.
 * ZH: 独立 investigation 子 agent 使用的系统说明。
 *
 * EN: It frames the evidence mandate so the model gathers facts with the filesystem tool and then answers,
 * without expecting a user to talk to or any ability to change files.
 * ZH: 它约束模型使用 filesystem tool 收集事实后再回答，不期待用户继续对话，也不具备改文件能力。
 */
export const INVESTIGATION_SYSTEM = [
    'You are a focused read-only investigator.',
    'Use the available filesystem tool to gather concrete evidence for the task, then give a clear, sourced answer.',
    'You cannot write or change anything, and there is no user to ask — decide and answer from the evidence you collect.',
    'Cite the files or matches your answer rests on. Stop as soon as you can answer confidently.',
].join('\n');

/**
 * EN: One finished investigation.
 * ZH: 一次已完成 investigation。
 *
 * EN: `answer` is the synthesized read-only finding; `steps` is how many provider turns it took for diagnostics.
 * ZH: `answer` 是综合后的只读结论；`steps` 是 provider turn 数，用于诊断。
 */
export interface InvestigationOutcome {
    answer: string;
    steps: number;
    completed: boolean;
    paused: boolean;
    evidence: string[];
}
