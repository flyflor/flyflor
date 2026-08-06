import type { AgentInteractionRequest } from '@/agent/types';
import type { OutboundIpcAction } from '@/ipc/types';
import type { CortexSignal } from '@/core';

export enum CollectiveSignalType {
    Output = 'output',
    AgentEvent = 'agent_event',
}

export interface CollectiveOutput {
    action: OutboundIpcAction;
    data: unknown;
    targets?: string[];
}

export interface CollectiveSignal extends CortexSignal<string> {
    data: CollectiveOutput | unknown;
}

export type AttentionReceiptState = 'focused' | 'merged' | 'queued' | 'rejected';

export interface AttentionReceipt {
    messageId: string;
    state: AttentionReceiptState;
    focusId?: string;
    revision?: number;
    queueDepth: number;
}

export interface CommandReceipt {
    messageId: string;
    action: 'answer' | 'cancel';
    state: 'accepted';
}

export interface PendingInteraction {
    request: AgentInteractionRequest;
    resolve(response: unknown): void;
    reject(error: unknown): void;
}
