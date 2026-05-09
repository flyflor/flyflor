import { event, FpcEventType, type EventSink } from "../events/index.ts";
import type { ProcessEnvelope, ProcessRole } from "./protocol.ts";

export interface ChildProcessSpec {
    role: ProcessRole;
    name: string;
    cmd: string[];
    cwd: string;
    env?: Record<string, string>;
    restart?: {
        maxRestarts: number;
        initialBackoffMs: number;
        maxBackoffMs: number;
    };
    outputLimitBytes?: number;
}

export class ChildProcessSupervisor {
    private child?: ReturnType<typeof Bun.spawn>;
    private restarts = 0;
    private stopping = false;

    constructor(
        private readonly spec: ChildProcessSpec,
        private readonly events: EventSink,
    ) {}

    start(): void {
        this.stopping = false;
        this.spawn();
    }

    async stop(): Promise<void> {
        this.stopping = true;
        this.child?.kill();
        await this.child?.exited;
    }

    send(envelope: ProcessEnvelope): void {
        const stdin = this.child?.stdin;
        if (!stdin || typeof stdin === "number") {
            throw new Error(`Child process ${this.spec.name} is not writable`);
        }
        stdin.write(`${JSON.stringify(envelope)}\n`);
    }

    private spawn(): void {
        const child = Bun.spawn({
            cmd: this.spec.cmd,
            cwd: this.spec.cwd,
            env: this.spec.env,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        this.child = child;
        this.events.publish(
            event(FpcEventType.ProcessStart, {
                name: this.spec.name,
                role: this.spec.role,
                pid: child.pid,
            }),
        );

        void this.captureOutput(child.stdout, "stdout");
        void this.captureOutput(child.stderr, "stderr");
        void child.exited.then((exitCode) => this.handleExit(exitCode));
    }

    private async captureOutput(stream: ReadableStream<Uint8Array>, name: "stderr" | "stdout"): Promise<void> {
        const limit = this.spec.outputLimitBytes ?? 64 * 1024;
        const reader = stream.getReader();
        let total = 0;

        while (true) {
            const read = await reader.read();
            if (read.done) {
                break;
            }
            total += read.value.byteLength;
            if (total > limit) {
                this.events.publish(
                    event(FpcEventType.ProcessOutputTruncated, {
                        name: this.spec.name,
                        role: this.spec.role,
                        stream: name,
                        limit,
                    }),
                );
                break;
            }
            const text = new TextDecoder().decode(read.value);
            this.events.publish(
                event(FpcEventType.ProcessOutput, {
                    name: this.spec.name,
                    role: this.spec.role,
                    stream: name,
                    text,
                }),
            );
        }
    }

    private handleExit(exitCode: number): void {
        this.events.publish(
            event(FpcEventType.ProcessExit, {
                name: this.spec.name,
                role: this.spec.role,
                exitCode,
            }),
        );

        if (this.stopping || !this.spec.restart) {
            return;
        }
        if (this.restarts >= this.spec.restart.maxRestarts) {
            this.events.publish(
                event(FpcEventType.ProcessRestartGiveUp, {
                    name: this.spec.name,
                    role: this.spec.role,
                    restarts: this.restarts,
                }),
            );
            return;
        }

        const backoff = Math.min(
            this.spec.restart.initialBackoffMs * 2 ** this.restarts,
            this.spec.restart.maxBackoffMs,
        );
        this.restarts += 1;
        setTimeout(() => this.spawn(), backoff);
    }
}
