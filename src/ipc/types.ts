import type { AgentInteractionResponse } from '@/agent/types';

export const IPC_PROTOCOL = 'flyflor.ipc' as const;
export const IPC_ID_MAX_CHARS = 512;

export interface IpcEnvelope<A extends string = string, D = unknown> {
    protocol: typeof IPC_PROTOCOL;
    messageId: string;
    action: A;
    data: D;
}

export interface UserInput {
    speakerId: string;
    text: string;
    replyTo?: string;
}

export interface AnswerInput {
    speakerId: string;
    focusId: string;
    requestId: string;
    response: AgentInteractionResponse;
}

export interface CancelInput {
    speakerId: string;
    focusId: string;
}

export type InboundIpcEnvelope =
    | IpcEnvelope<'user', UserInput>
    | IpcEnvelope<'answer', AnswerInput>
    | IpcEnvelope<'cancel', CancelInput>;

export type OutboundIpcAction =
    | 'open'
    | 'attention'
    | 'agent'
    | 'responseReset'
    | 'streamEnd'
    | 'event'
    | 'ask'
    | 'confirm'
    | 'error';
