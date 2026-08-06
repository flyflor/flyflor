import type { Socket, UnixSocketListener } from 'bun';
import { rm } from 'node:fs/promises';
import { AgentManager, CollectiveSignalType, type CollectiveOutput } from '@/collective';
import type { ConfigService } from '@/configuration';
import { Config, FComponent, Init, Inject, Singleton, useContainer } from '@/core';
import { IPCPacket } from '../packet';
import { IPC_ID_MAX_CHARS, IPC_PROTOCOL, type AnswerInput, type CancelInput, type InboundIpcEnvelope, type IpcEnvelope, type UserInput } from '../types';
import { SocketConnection, type SocketConnectionData } from './connection';

/** EN: Multi-client Unix socket gateway for Flyflor IPC. ZH: Flyflor IPC 的多客户端 Unix socket gateway。 */
@Singleton()
export class FSocket extends FComponent {
    @Config()
    public config!: ConfigService;

    @Inject()
    public packet!: IPCPacket;

    @Inject()
    public manager!: AgentManager;

    public service?: UnixSocketListener<object>;
    public readonly connections = new Map<string, SocketConnection>();
    private readonly socketIds = new WeakMap<Socket<SocketConnectionData>, string>();

    @Init()
    public async init(): Promise<void> {
        this.manager.on(CollectiveSignalType.Output, (signal) => this.deliver(signal.data as CollectiveOutput));
        await rm(this.config.socket, { force: true });
        this.service = Bun.listen({
            unix: this.config.socket,
            socket: {
                open: this.open.bind(this),
                close: this.close.bind(this),
                error: this.error.bind(this),
                drain: this.drain.bind(this),
                data: this.data.bind(this),
            },
        });
        this.log.info('ipc.listening', { path: this.config.socket, protocol: IPC_PROTOCOL });
    }

    public open(socket: Socket<SocketConnectionData>): void {
        const connectionId = crypto.randomUUID();
        const connection = useContainer().create(SocketConnection, socket, connectionId, this.packet);
        this.connections.set(connectionId, connection);
        this.socketIds.set(socket, connectionId);
        this.write(connection, 'open', { connectionId, protocol: IPC_PROTOCOL });
    }

    public close(socket: Socket<SocketConnectionData>, error?: Error): void {
        const connection = this.connection(socket);
        if (!connection) return;
        connection.close();
        this.connections.delete(connection.id);
        this.socketIds.delete(socket);
        this.manager.disconnect(connection.id);
        this.log.info('ipc.close', { connectionId: connection.id, error: error?.message });
    }

    public error(socket: Socket<SocketConnectionData>, error: Error): void {
        const connection = this.connection(socket);
        if (connection) this.write(connection, 'error', { message: error.message });
        this.log.error('ipc.error', error);
    }

    public drain(socket: Socket<SocketConnectionData>): void {
        this.connection(socket)?.drain();
    }

    public async data(socket: Socket<SocketConnectionData>, data: Uint8Array): Promise<void> {
        const connection = this.connection(socket);
        if (!connection) return;
        try {
            await connection.receive(data, async (value) => {
                const envelope = this.envelope(value);
                await this.dispatch(connection, envelope);
            }, (error) => this.write(connection, 'error', { message: this.message(error) }));
        } catch (error) {
            this.write(connection, 'error', { message: this.message(error) });
        }
    }

    private async dispatch(connection: SocketConnection, envelope: InboundIpcEnvelope): Promise<void> {
        if (envelope.action === 'user') {
            const receipt = await this.manager.receive({
                messageId: envelope.messageId,
                speakerId: envelope.data.speakerId,
                connectionId: connection.id,
                text: envelope.data.text,
                replyTo: envelope.data.replyTo,
                receivedAt: Date.now(),
            });
            this.write(connection, 'event', { type: 'receipt', receipt });
            return;
        }
        if (envelope.action === 'answer') {
            const receipt = this.manager.answer(envelope.data, connection.id, envelope.messageId);
            this.write(connection, 'event', { type: 'receipt', receipt });
            return;
        }
        const receipt = this.manager.cancel(envelope.data, connection.id, envelope.messageId);
        this.write(connection, 'event', { type: 'receipt', receipt });
    }

    private deliver(output: CollectiveOutput): void {
        const targets = output.targets === undefined
            ? [...this.connections.values()]
            : output.targets.map((id) => this.connections.get(id)).filter((item): item is SocketConnection => item !== undefined);
        for (const connection of targets) this.write(connection, output.action, output.data);
    }

    private write(connection: SocketConnection, action: string, data: unknown): void {
        try {
            connection.write({ protocol: IPC_PROTOCOL, messageId: crypto.randomUUID(), action, data });
        } catch (error) {
            this.log.error('ipc.write', error);
            if (action === 'error') return;
            try {
                connection.write({
                    protocol: IPC_PROTOCOL,
                    messageId: crypto.randomUUID(),
                    action: 'error',
                    data: { message: `IPC output rejected: ${this.message(error)}` },
                });
            } catch (nested) {
                this.log.error('ipc.write.error', nested);
            }
        }
    }

    private connection(socket: Socket<SocketConnectionData>): SocketConnection | undefined {
        const id = this.socketIds.get(socket);
        return id === undefined ? undefined : this.connections.get(id);
    }

    private envelope(value: IpcEnvelope): InboundIpcEnvelope {
        if (typeof value !== 'object' || value === null) throw Error('IPC envelope must be an object');
        if (value.protocol !== IPC_PROTOCOL) throw Error(`Unsupported IPC protocol: ${String(value.protocol)}`);
        this.identifier(value.messageId, 'messageId');
        if (value.action === 'user') return { ...value, action: 'user', data: this.user(value.data) };
        if (value.action === 'answer') return { ...value, action: 'answer', data: this.answer(value.data) };
        if (value.action === 'cancel') return { ...value, action: 'cancel', data: this.cancelInput(value.data) };
        throw Error(`Unsupported IPC action: ${String(value.action)}`);
    }

    private user(value: unknown): UserInput {
        if (typeof value !== 'object' || value === null) throw Error('IPC user data must be an object');
        const data = value as Record<string, unknown>;
        const speakerId = this.identifier(data.speakerId, 'speakerId');
        if (typeof data.text !== 'string' || data.text.trim().length === 0) throw Error('text is required');
        const replyTo = data.replyTo === undefined ? undefined : this.identifier(data.replyTo, 'replyTo');
        return { speakerId, text: data.text, replyTo };
    }

    private answer(value: unknown): AnswerInput {
        if (typeof value !== 'object' || value === null) throw Error('IPC answer data must be an object');
        const data = value as Record<string, unknown>;
        const speakerId = this.identifier(data.speakerId, 'speakerId');
        const focusId = this.identifier(data.focusId, 'focusId');
        const requestId = this.identifier(data.requestId, 'requestId');
        if (typeof data.response !== 'object' || data.response === null) throw Error('response is required');
        const response = data.response as Record<string, unknown>;
        if (response.kind === 'confirm') {
            if (typeof response.approved !== 'boolean') throw Error('confirm response approved must be a boolean');
            return {
                speakerId,
                focusId,
                requestId,
                response: { kind: 'confirm', approved: response.approved },
            };
        } else if (response.kind === 'ask') {
            if (!Array.isArray(response.answers) || response.answers.some((answer) => (
                typeof answer !== 'object'
                || answer === null
                || typeof (answer as Record<string, unknown>).question !== 'string'
                || typeof (answer as Record<string, unknown>).answer !== 'string'
            ))) throw Error('ask response answers are invalid');
            return {
                speakerId,
                focusId,
                requestId,
                response: {
                    kind: 'ask',
                    answers: response.answers.map((answer) => ({
                        question: (answer as Record<string, string>).question!,
                        answer: (answer as Record<string, string>).answer!,
                    })),
                },
            };
        } else {
            throw Error('response kind must be ask or confirm');
        }
    }

    private cancelInput(value: unknown): CancelInput {
        if (typeof value !== 'object' || value === null) throw Error('IPC cancel data must be an object');
        const data = value as Record<string, unknown>;
        return {
            speakerId: this.identifier(data.speakerId, 'speakerId'),
            focusId: this.identifier(data.focusId, 'focusId'),
        };
    }

    private identifier(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.trim().length === 0) throw Error(`${name} is required`);
        if (value.length > IPC_ID_MAX_CHARS) throw Error(`${name} exceeds ${IPC_ID_MAX_CHARS} characters`);
        return value;
    }

    private message(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
