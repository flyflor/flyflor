import 'reflect-metadata';

import { Agent, type AgentBus, type CompleteSignal, type NeuralSignal } from '@/agent';
import { AppModule } from '@/app';
import { Factory, FService, useContainer } from '@/core';
import { configureLogger, LoggerLevel } from '@/core/logger';
import { Synapse } from '@/neural';
import { FSocket } from '@/transport';
import { IpcClientBridge } from '../web/client';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

interface BridgePacket {
    action: string;
    data: unknown;
}

interface TurnOptions {
    askAnswer?: string;
    approved?: boolean;
    reconnect?: 'ask' | 'confirm';
}

/**
 * EN: Drives the real browser bridge as one strict sequential packet consumer.
 * ZH: 作为严格串行 packet consumer 驱动真实 browser bridge。
 */
class BrowserProbe extends FService {
    private socket?: WebSocket;
    private readonly inbox: BridgePacket[];
    private waiting?: (packet: BridgePacket) => void;

    /** EN: Binds this probe to one live WebSocket endpoint. ZH: 将 probe 绑定到一个真实 WebSocket endpoint。 */
    public constructor(private readonly endpoint: string) {
        super();
        this.inbox = [];
    }

    /** EN: Connects to the bridge and waits for the kernel open packet. ZH: 连接 bridge 并等待 kernel open packet。 */
    public async connect(): Promise<void> {
        this.socket = new WebSocket(this.endpoint);
        this.socket.addEventListener('message', (event) => this.receive(event.data));
        this.socket.addEventListener('error', () => { throw Error('Live WebSocket connection failed'); });
        await this.boundary(
            new Promise<void>((resolve) => this.socket?.addEventListener('open', () => resolve(), { once: true })),
            'WebSocket open',
        );
        const packet = await this.next();
        assert.equal(packet.action, 'open');
    }

    /** EN: Sends one browser JSON packet to the kernel bridge. ZH: 向 kernel bridge 发送一个 browser JSON packet。 */
    public send(packet: BridgePacket): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw Error('Live WebSocket is not open');
        this.socket.send(JSON.stringify(packet));
    }

    /** EN: Returns the next decoded bridge packet with a strict timeout. ZH: 在严格 timeout 内返回下一个 decoded bridge packet。 */
    public async next(): Promise<BridgePacket> {
        const packet = this.inbox.shift();
        if (packet) return packet;
        if (this.waiting) throw Error('Live packet consumer is already waiting');
        return await this.boundary(
            new Promise<BridgePacket>((resolve) => { this.waiting = resolve; }),
            'next IPC packet',
        );
    }

    /** EN: Closes the browser connection and waits for its terminal event. ZH: 关闭 browser connection 并等待终态事件。 */
    public async disconnect(): Promise<void> {
        if (!this.socket || this.socket.readyState === WebSocket.CLOSED) return;
        const closed = new Promise<void>((resolve) => this.socket?.addEventListener('close', () => resolve(), { once: true }));
        this.socket.close();
        await this.boundary(closed, 'WebSocket close');
        this.socket = undefined;
        this.inbox.length = 0;
        this.waiting = undefined;
    }

    /** EN: Delivers one strict JSON WebSocket message to its single consumer. ZH: 将一个严格 JSON WebSocket message 交给唯一 consumer。 */
    private receive(value: unknown): void {
        if (typeof value !== 'string') throw Error('Live bridge returned a non-text message');
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw Error('Live bridge packet is invalid');
        const packet = parsed as { action?: unknown; data?: unknown };
        if (typeof packet.action !== 'string') throw Error('Live bridge packet action is invalid');
        const normalized = { action: packet.action, data: packet.data };
        const waiting = this.waiting;
        if (!waiting) {
            this.inbox.push(normalized);
            return;
        }
        this.waiting = undefined;
        waiting(normalized);
    }

    /** EN: Waits at one live boundary and always clears its rejecting timer. ZH: 等待一个 live boundary，并始终清理 rejecting timer。 */
    private async boundary<T>(operation: Promise<T>, name: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(Error(`Timed out waiting for ${name}`)), 180000);
        });
        try {
            return await Promise.race([operation, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}

/**
 * EN: Exercises every cognitive route and concrete tool through the configured real provider.
 * ZH: 通过已配置真实 provider 验收全部认知路径与具体工具。
 */
class LiveScenarios extends FService {
    private synapse?: Synapse;
    private bridge?: ReturnType<typeof IpcClientBridge.start>;
    private probe?: BrowserProbe;
    private workspace: string;
    private readonly passed: string[];

    /** EN: Creates empty ownership for one disposable live-suite run. ZH: 为一次性 live suite 创建空所有权状态。 */
    public constructor() {
        super();
        this.workspace = '';
        this.passed = [];
    }

    /** EN: Runs the complete live suite and releases only test-owned resources. ZH: 运行完整 live suite，并只释放测试拥有的资源。 */
    public async run(): Promise<void> {
        this.workspace = mkdtempSync(join(tmpdir(), 'flyflor-live-'));
        configureLogger({ consoleEnabled: false, colorEnabled: false, level: LoggerLevel.Debug, path: join(this.workspace, 'live.log') });
        try {
            await this.start();
            await this.replyScenario();
            await this.readScenario();
            await this.askScenario();
            await this.rejectedWriteScenario();
            await this.approvedWriteScenario();
            await this.shellScenario();
            await this.executeScenario();
            await this.taskScenario();
            await this.reconnectScenario();
            await this.soulScenario();
            console.log(JSON.stringify({ provider: this.synapse?.config.model.provider, model: this.synapse?.config.model.model, passed: this.passed }, null, 2));
        } finally {
            await this.stop();
            rmSync(this.workspace, { recursive: true, force: true });
        }
    }

    /** EN: Starts the real application graph, IPC socket, bridge, and browser probe. ZH: 启动真实 application graph、IPC socket、bridge 与 browser probe。 */
    private async start(): Promise<void> {
        await Factory.create(AppModule);
        this.synapse = await useContainer().getAsync(Synapse);
        const keyName = this.synapse.config.model.apiKeyEnv;
        if (!process.env[keyName]) throw Error(`Live model credential is missing: ${keyName}`);
        this.bridge = IpcClientBridge.start({ host: '127.0.0.1', port: 0 });
        this.probe = useContainer().create(BrowserProbe, `ws://${this.bridge.hostname}:${this.bridge.port}`);
        await this.probe.connect();
    }

    /** EN: Verifies direct reply perception and expression. ZH: 验证直接 reply 感知与表达。 */
    private async replyScenario(): Promise<void> {
        const packets = await this.turn('Reply with exactly REPLY_SCENARIO_OK and nothing else. Do not use tools.', { approved: false });
        assert.match(this.text(packets), /REPLY_SCENARIO_OK/);
        assert.equal(this.complete(packets).evidence.length, 0);
        this.passed.push('reply');
        console.log('[live] passed: reply');
    }

    /** EN: Verifies real filesystem read selection and evidence replay. ZH: 验证真实 filesystem read 选择与 evidence replay。 */
    private async readScenario(): Promise<void> {
        const path = join(this.workspace, 'read.txt');
        writeFileSync(path, 'READ_SCENARIO_OK', 'utf8');
        const packets = await this.turn(`Use the filesystem tool to read ${path}, then reply with the exact token in that file.`, { approved: false });
        assert.match(this.text(packets), /READ_SCENARIO_OK/);
        assert.match(this.complete(packets).evidence.join('\n'), /filesystem/);
        this.passed.push('filesystem-read');
        console.log('[live] passed: filesystem-read');
    }

    /** EN: Verifies structured Ask, pause, answer, and resume. ZH: 验证结构化 Ask、pause、answer 与 resume。 */
    private async askScenario(): Promise<void> {
        const packets = await this.turn('You must use the ask tool to ask whether the target environment is staging or production. Do not guess. After the answer, reply with the selected environment.', { askAnswer: 'staging', approved: false, reconnect: 'ask' });
        assert.ok(packets.some((packet) => packet.action === 'ask'));
        assert.ok(packets.some((packet) => packet.action === 'pause'));
        assert.ok(packets.some((packet) => packet.action === 'resume'));
        assert.match(this.text(packets), /staging/i);
        this.passed.push('ask');
        console.log('[live] passed: ask');
    }

    /** EN: Verifies rejected Confirm produces no filesystem mutation. ZH: 验证拒绝 Confirm 时不产生 filesystem mutation。 */
    private async rejectedWriteScenario(): Promise<void> {
        const path = join(this.workspace, 'rejected.txt');
        writeFileSync(path, 'ORIGINAL', 'utf8');
        const packets = await this.turn(`Use the filesystem write action to replace ${path} with exactly REJECTED_WRITE. Attempt the requested write.`, { approved: false });
        assert.ok(packets.some((packet) => packet.action === 'confirm'));
        assert.equal(readFileSync(path, 'utf8'), 'ORIGINAL');
        assert.match(this.complete(packets).evidence.join('\n'), /approved=false; executed=false/);
        this.passed.push('confirm-reject');
        console.log('[live] passed: confirm-reject');
    }

    /** EN: Verifies approved Confirm permits one exact filesystem write. ZH: 验证批准 Confirm 后允许一次精确 filesystem write。 */
    private async approvedWriteScenario(): Promise<void> {
        const path = join(this.workspace, 'approved.txt');
        writeFileSync(path, 'ORIGINAL', 'utf8');
        const packets = await this.turn(`Use the filesystem write action to replace ${path} with exactly APPROVED_WRITE.`, { approved: true, reconnect: 'confirm' });
        assert.ok(packets.some((packet) => packet.action === 'confirm'));
        assert.equal(readFileSync(path, 'utf8'), 'APPROVED_WRITE');
        this.passed.push('filesystem-write');
        console.log('[live] passed: filesystem-write');
    }

    /** EN: Verifies approved Shell execution and result replay. ZH: 验证批准后的 Shell execution 与 result replay。 */
    private async shellScenario(): Promise<void> {
        const path = join(this.workspace, 'shell.txt');
        writeFileSync(path, 'SHELL_SCENARIO_OK', 'utf8');
        const packets = await this.turn(`Use the shell tool with command wc and args ["-c", "${path}"] to determine the file's current byte count. Report the exact stdout.`, { approved: true });
        assert.match(this.text(packets), /17/);
        assert.match(this.complete(packets).evidence.join('\n'), /shell/);
        this.passed.push('shell');
        console.log('[live] passed: shell');
    }

    /** EN: Verifies approved Execute script batches and result replay. ZH: 验证批准后的 Execute script batch 与 result replay。 */
    private async executeScenario(): Promise<void> {
        const path = join(this.workspace, 'execute.sh');
        writeFileSync(path, 'printf EXECUTE_SCENARIO_OK', 'utf8');
        const packets = await this.turn(`Use the execute tool with one sh task whose path is ${path}, then report its exact stdout.`, { approved: true });
        assert.match(this.text(packets), /EXECUTE_SCENARIO_OK/);
        assert.match(this.complete(packets).evidence.join('\n'), /execute/);
        this.passed.push('execute');
        console.log('[live] passed: execute');
    }

    /** EN: Verifies real multi-person Task dispatch and root synthesis. ZH: 验证真实多人 Task 派发与根综合。 */
    private async taskScenario(): Promise<void> {
        const workerPath = join(this.workspace, 'worker.txt');
        const reviewerPath = join(this.workspace, 'reviewer.txt');
        writeFileSync(workerPath, 'WORKER_SCENARIO_OK', 'utf8');
        writeFileSync(reviewerPath, 'REVIEWER_SCENARIO_OK', 'utf8');
        const packets = await this.turn(`Use the task tool once with exactly two tasks. Assign worker the goal "Use Filesystem read on ${workerPath} and return its exact token." Assign reviewer the goal "Use Filesystem read on ${reviewerPath} and return its exact token." Then include both exact tokens in the final answer. The root must not use another tool.`, {
            approved: true,
            askAnswer: 'Proceed exactly as assigned with Filesystem read and return the exact token.',
        });
        const evidence = this.complete(packets).evidence.join('\n');
        assert.match(evidence, /agents=worker,reviewer/);
        assert.match(this.text(packets), /WORKER_SCENARIO_OK/);
        assert.match(this.text(packets), /REVIEWER_SCENARIO_OK/);
        this.passed.push('task');
        console.log('[live] passed: task');
    }

    /** EN: Verifies transport reconnect preserves Context and root Memory. ZH: 验证 transport reconnect 保留 Context 与根 Memory。 */
    private async reconnectScenario(): Promise<void> {
        if (!this.probe || !this.bridge) throw Error('Live bridge is not started');
        await this.probe.disconnect();
        this.probe = useContainer().create(BrowserProbe, `ws://${this.bridge.hostname}:${this.bridge.port}`);
        await this.probe.connect();
        const packets = await this.turn('What exact content was written during the approved filesystem write scenario? Reply with only that content and do not use tools.', { approved: false });
        assert.match(this.text(packets), /APPROVED_WRITE/);
        this.passed.push('reconnect-memory');
        console.log('[live] passed: reconnect-memory');
    }

    /** EN: Verifies the Soul route against a disposable identity package. ZH: 使用一次性 identity package 验证 Soul 路径。 */
    private async soulScenario(): Promise<void> {
        if (!this.synapse) throw Error('Live Synapse is not started');
        const identity = join(this.workspace, 'identity');
        cpSync(join(this.synapse.config.path.root, '.config', 'agents', 'flyflor'), identity, { recursive: true });
        const source = this.synapse.config.agents[this.synapse.config.agent];
        if (!source) throw Error('Live root profile is missing');
        const signals: NeuralSignal[] = [];
        const bus = {
            fire: async (signal: NeuralSignal) => {
                signals.push(signal);
                if (signal.type === 'ask' || signal.type === 'confirm' || signal.type === 'task') throw Error(`Unexpected Soul signal: ${signal.type}`);
                return undefined as never;
            },
        } as AgentBus;
        const agent = await useContainer().getAsync(Agent, {
            ...source,
            name: 'soul-live',
            promptPackage: relative(this.synapse.config.path.root, identity),
            promptSections: ['SOUL', 'USER', 'EXTENSION'],
        }, bus);
        const complete = await agent.receive({ type: 'input', input: 'Remember permanently that my stable live verification marker is SOUL_SCENARIO_OK. This is an explicit durable user fact.' });
        assert.match(complete.answer, /更新|update/i);
        assert.ok(signals.some((signal) => signal.type === 'complete'));
        const content = ['SOUL.md', 'USER.md', 'EXTENSION.md'].map((file) => readFileSync(join(identity, file), 'utf8')).join('\n');
        assert.match(content, /SOUL_SCENARIO_OK/);
        this.passed.push('soul');
        console.log('[live] passed: soul');
    }

    /** EN: Runs one root Turn through browser packets and exact interactions. ZH: 通过 browser packets 与精确交互运行一个根 Turn。 */
    private async turn(input: string, options: TurnOptions = {}): Promise<BridgePacket[]> {
        if (!this.probe) throw Error('Live browser probe is not connected');
        this.probe.send({ action: 'user', data: { text: input } });
        const packets: BridgePacket[] = [];
        let reconnected = false;
        while (true) {
            const packet = await this.probe.next();
            packets.push(packet);
            if (packet.action === 'error') throw Error(`Kernel returned an error packet: ${String(packet.data)}`);
            if (!reconnected && packet.action === options.reconnect) {
                const replay = await this.reconnectInteraction(packet, packets);
                reconnected = true;
                if (replay.action === 'ask') this.answerAsk(replay, options.askAnswer);
                else this.answerConfirm(replay, options.approved);
            } else {
                if (packet.action === 'ask') this.answerAsk(packet, options.askAnswer);
                if (packet.action === 'confirm') this.answerConfirm(packet, options.approved);
            }
            if (packet.action === 'streamEnd') break;
        }
        this.complete(packets);
        return packets;
    }

    /** EN: Refreshes during one pending interaction and validates its exact replay order. ZH: 在一次 pending interaction 期间刷新，并验证其精确重放顺序。 */
    private async reconnectInteraction(original: BridgePacket, packets: BridgePacket[]): Promise<BridgePacket> {
        if (!this.probe || !this.bridge || (original.action !== 'ask' && original.action !== 'confirm')) throw Error('Live reconnect interaction is invalid');
        await this.probe.disconnect();
        this.probe = useContainer().create(BrowserProbe, `ws://${this.bridge.hostname}:${this.bridge.port}`);
        await this.probe.connect();
        const replay = await this.probe.next();
        const pause = await this.probe.next();
        packets.push(replay, pause);
        assert.equal(replay.action, original.action);
        assert.equal(pause.action, 'pause');
        const originalCorrelation = this.correlation(original);
        const replayCorrelation = this.correlation(replay);
        assert.deepEqual(replayCorrelation, originalCorrelation);
        assert.deepEqual(this.correlation(pause), originalCorrelation);
        return replay;
    }

    /** EN: Reads exact Turn and interaction ids from one replay packet. ZH: 从一个重放 packet 读取精确 Turn 与 interaction id。 */
    private correlation(packet: BridgePacket): { turnId: string; id: string } {
        if (typeof packet.data !== 'object' || packet.data === null || Array.isArray(packet.data)) throw Error('Live interaction correlation is invalid');
        const data = packet.data as { turnId?: unknown; id?: unknown };
        if (typeof data.turnId !== 'string' || data.turnId.length === 0 || typeof data.id !== 'string' || data.id.length === 0) {
            throw Error('Live interaction correlation is invalid');
        }
        return { turnId: data.turnId, id: data.id };
    }

    /** EN: Answers every strict Ask question with the scenario value. ZH: 使用场景值回答每个严格 Ask question。 */
    private answerAsk(packet: BridgePacket, answer?: string): void {
        if (!this.probe || typeof answer !== 'string') throw Error('Live Ask answer is missing');
        const data = packet.data as { turnId?: unknown; id?: unknown; questions?: unknown };
        if (typeof data.turnId !== 'string' || typeof data.id !== 'string' || !Array.isArray(data.questions)) throw Error('Live Ask packet is invalid');
        const answers = data.questions.map((question, index) => {
            if (typeof question !== 'object' || question === null || typeof (question as { question?: unknown }).question !== 'string') throw Error(`Live Ask question is invalid: ${index}`);
            return { question: (question as { question: string }).question, answer };
        });
        this.probe.send({ action: 'answer', data: { turnId: data.turnId, id: data.id, response: { kind: 'ask', answers } } });
    }

    /** EN: Answers one strict Confirm with the scenario decision. ZH: 使用场景决策回答一个严格 Confirm。 */
    private answerConfirm(packet: BridgePacket, approved?: boolean): void {
        if (!this.probe || typeof approved !== 'boolean') throw Error('Live Confirm decision is missing');
        const data = packet.data as { turnId?: unknown; id?: unknown };
        if (typeof data.turnId !== 'string' || typeof data.id !== 'string') throw Error('Live Confirm packet is invalid');
        this.probe.send({ action: 'answer', data: { turnId: data.turnId, id: data.id, response: { kind: 'confirm', approved } } });
    }

    /** EN: Concatenates ordered user-visible reply chunks. ZH: 拼接有序、用户可见的 reply chunks。 */
    private text(packets: BridgePacket[]): string {
        return packets.filter((packet) => packet.action === 'agent').map((packet) => String(packet.data)).join('');
    }

    /** EN: Returns and validates the single root Complete packet. ZH: 返回并验证唯一根 Complete packet。 */
    private complete(packets: BridgePacket[]): CompleteSignal {
        const matches = packets.filter((packet) => packet.action === 'complete');
        assert.equal(matches.length, 1);
        const value = matches[0]?.data;
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Live Complete packet is invalid');
        const complete = value as Partial<CompleteSignal>;
        if (complete.type !== 'complete' || typeof complete.answer !== 'string' || !Array.isArray(complete.evidence)) throw Error('Live Complete payload is invalid');
        return complete as CompleteSignal;
    }

    /** EN: Stops only live-test transports and listeners. ZH: 只停止 live test transport 与 listener。 */
    private async stop(): Promise<void> {
        if (this.probe) await this.probe.disconnect();
        if (this.bridge) await this.bridge.stop(true);
        if (this.synapse) (await useContainer().getAsync(FSocket)).stop();
        if (this.synapse) rmSync(this.synapse.config.socket, { force: true });
    }
}

await useContainer().create(LiveScenarios).run();
