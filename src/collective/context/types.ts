import type { MemoryNote } from '@/agent/memory/types';
import type { DialogueTurn } from '@/collective/history/types';

export interface Stimulus {
    messageId: string;
    speakerId: string;
    connectionId: string;
    text: string;
    replyTo?: string;
    receivedAt: number;
}

export type FocusState = 'working' | 'waiting' | 'completed' | 'cancelled';

export interface FocusParticipant {
    speakerId: string;
    connectionIds: string[];
}

export interface Focus {
    id: string;
    revision: number;
    ownerSpeakerId: string;
    state: FocusState;
    stimuli: Stimulus[];
    participants: FocusParticipant[];
    consultants: string[];
    goal: string;
    constraints: string[];
    references: string[];
    createdAt: number;
    updatedAt: number;
}

/**
 * EN: Workspace item kinds. `fact` carries any informative record (answers, evidence,
 * summaries); `constraint` and `open` are protected; `digest` marks condensed batches.
 * ZH: 工作空间条目类型。`fact` 承载一切信息性记录（回答、证据、摘要）；
 * `constraint` 与 `open` 受保护；`digest` 标记已压缩批次。
 */
export type ContextItemKind = 'fact' | 'constraint' | 'open' | 'digest';

export interface ContextItem {
    id: string;
    kind: ContextItemKind;
    content: string;
    sourceFocusId: string;
    sourceMessageIds: string[];
    speakerIds: string[];
    agentId?: string;
    salience: number;
    createdAt: number;
    lastAccessedAt: number;
}

/**
 * EN: The focus projection handed to one agent: the same stimulus data without
 * transport routing or scheduler state.
 * ZH: 交给单个 agent 的焦点投影：不含传输路由与调度状态。
 */
export interface AgentFocus {
    id: string;
    revision: number;
    ownerSpeakerId: string;
    messages: Array<Pick<Stimulus, 'messageId' | 'speakerId' | 'text' | 'replyTo'>>;
    goal: string;
    constraints: string[];
    references: string[];
}

export interface AgentContext {
    agentId: string;
    focus: AgentFocus;
    history: DialogueTurn[];
    items: ContextItem[];
    localMemory: MemoryNote[];
}
