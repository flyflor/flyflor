import type { AgentInteractionRequest, AgentRuntimeEvent } from '@/agent/types';
import type { OutboundIpcAction } from '@/ipc/types';
import type { Signal } from '@/core';
import type { Spike } from './scout';

/**
 * EN: Typed signals routed through the Cortex bus (cortical discharges).
 * ZH: 经皮层信号总线路由的类型化信号（皮层放电）。
 */
export enum CollectiveSignalType {
    Spike = 'spike',
    Output = 'output',
    AgentEvent = 'agent_event',
}

export interface CollectiveOutput {
    action: OutboundIpcAction;
    data: unknown;
    targets?: string[];
}

export type CollectiveSignal = Signal<CollectiveSignalType, Spike | CollectiveOutput | AgentRuntimeEvent>;

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
