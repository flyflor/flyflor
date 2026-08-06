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

export type ContextItemKind = 'summary' | 'fact' | 'constraint' | 'decision' | 'evidence' | 'open';

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

export interface AgentStimulus {
    messageId: string;
    speakerId: string;
    text: string;
    replyTo?: string;
}

export interface AgentFocus {
    id: string;
    revision: number;
    ownerSpeakerId: string;
    messages: AgentStimulus[];
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
