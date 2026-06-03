import { FModule, Module } from '@/core';
import { IPCModule } from '@/capillary/ipc';
import { GuardModule } from '@/capillary/guard';

/**
 * Categories of packet that move through the capillary blood-vessel layer.
 * Values are public, JSON-serializable strings because packets may be mirrored to IPC clients and audit logs.
 * - `Notice`: a fire-and-observe event with no expected answer.
 * - `Decision`: a consultation that asks subscribers to allow or deny an action (ASK / Confirm / sandbox).
 * - `DecisionResult`: the resolved outcome of a `Decision`, emitted for observers.
 */
export enum CapillaryPacketKind {
    Notice = 'notice',
    Decision = 'decision',
    DecisionResult = 'decision-result',
}

/**
 * The two outcomes a consultation can resolve to.
 * `Allow` lets the action proceed; `Deny` blocks it with an optional structured reason.
 */
export enum CapillaryDecision {
    Allow = 'allow',
    Deny = 'deny',
}

/**
 * One packet flowing through the capillary layer.
 * `payload` stays JSON-serializable so the packet can cross module and socket boundaries unchanged.
 */
export interface CapillaryPacket<TPayload = unknown> {
    id: string;
    kind: CapillaryPacketKind;
    topic: string;
    payload: TPayload;
    createdAt: string;
}

/**
 * The structured outcome of a consultation.
 */
export interface CapillaryConsultResult {
    decision: CapillaryDecision;
    reason?: string;
}

/**
 * A passive observer of broadcast packets.
 */
export interface CapillaryBroadcastListener {
    (packet: CapillaryPacket): void | Promise<void>;
}

/**
 * A responder that answers a consultation with allow/deny.
 */
export interface CapillaryConsultListener {
    (packet: CapillaryPacket): CapillaryConsultResult | Promise<CapillaryConsultResult>;
}

/**
 * Flyflor's capillary "blood-vessel" layer — a tiny, dependency-free typed pub/sub (no RxJS, rule 6).
 *
 * It carries cross-cutting flow (events, ASK, Confirm, sandbox decisions) so the kernel can simply
 * `await capillary.ask(...)` / `await capillary.confirm(...)`, while guards and the IPC layer subscribe via DI.
 * This keeps the kernel's context-distillation/recall logic decoupled from where decisions actually come from.
 */
@Module({
    imports: [GuardModule, IPCModule],
})
export class CapillaryModule extends FModule {
    private readonly broadcastListeners = new Set<CapillaryBroadcastListener>();
    private readonly consultListeners = new Set<CapillaryConsultListener>();

    public subscribe(listener: CapillaryBroadcastListener): () => void {
        this.broadcastListeners.add(listener);
        return () => this.broadcastListeners.delete(listener);
    }

    public onConsult(listener: CapillaryConsultListener): () => void {
        this.consultListeners.add(listener);
        return () => this.consultListeners.delete(listener);
    }

    public async notice<TPayload>(topic: string, payload: TPayload): Promise<void> {
        const packet = this.packet(CapillaryPacketKind.Notice, topic, payload);
        for (const listener of this.broadcastListeners) {
            await listener(packet);
        }
    }

    public async ask<TPayload>(topic: string, payload: TPayload): Promise<CapillaryConsultResult> {
        const packet = this.packet(CapillaryPacketKind.Decision, topic, payload);
        for (const listener of this.consultListeners) {
            const result = await listener(packet);
            if (result.decision === CapillaryDecision.Deny) {
                return result;
            }
        }
        return { decision: CapillaryDecision.Allow };
    }

    public async confirm<TPayload>(topic: string, payload: TPayload): Promise<boolean> {
        const result = await this.ask(topic, payload);
        return result.decision === CapillaryDecision.Allow;
    }

    public packet<TPayload>(kind: CapillaryPacketKind, topic: string, payload: TPayload): CapillaryPacket<TPayload> {
        return {
            id: crypto.randomUUID(),
            kind,
            topic,
            payload,
            createdAt: new Date().toISOString(),
        };
    }
}
