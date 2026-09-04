import { describe, expect, test } from 'bun:test';
import type { Agent, AgentReport } from '@/agent';
import type { FAgentProfileConfiguration, ConfigService } from '@/configuration';
import { useContainer } from '@/core';
import { Ledger } from '@/ledger';
import { Attention } from './attention';
import { Scout } from './scout';
import { Context } from './context';
import { History } from './history';
import { Cortex } from './cortex';
import { CollectiveSignalType, type CollectiveOutput } from './types';
import type { Stimulus } from './context';

const profile = (name: string, role: FAgentProfileConfiguration['role'], actionScope: FAgentProfileConfiguration['actionScope']): FAgentProfileConfiguration => ({
    name, role, actionScope, description: name, capabilities: [], model: 'model', provider: 'provider', contextLength: 32000, maxTokens: 1000,
});

const config = (queueLimit = 64): ConfigService => ({
    collective: { leader: 'flyflor', queueLimit, contextItemLimit: 128, contextCharLimit: 32000, agentNoteLimit: 24, historyShare: 0.25 },
    agents: { flyflor: profile('flyflor', 'leader', 'full'), researcher: profile('researcher', 'specialist', 'read'), reviewer: profile('reviewer', 'specialist', 'read') },
    model: { model: 'model', default: 'model', provider: 'provider', contextLength: 32000, maxTokens: 1000 },
} as unknown as ConfigService);

const stimulus = (messageId: string, speakerId = 'speaker-a', replyTo?: string): Stimulus => ({
    messageId, speakerId, connectionId: `connection-${speakerId}`, text: messageId, replyTo, receivedAt: Date.now(),
});

const report = (agentId: string, answer: string): AgentReport => ({ agentId, answer, evidence: [`${agentId} evidence`], remaining: [], steps: 1 });

const fakeAgent = (name: string, run: (context: unknown, control: any) => Promise<AgentReport>): Agent => ({
    agentConfig: profile(name, name === 'flyflor' ? 'leader' : 'specialist', name === 'flyflor' ? 'full' : 'read'),
    run,
    memory: () => [],
} as unknown as Agent);

const ledger = (): Ledger => {
    const value = useContainer().create(Ledger);
    value.config = { ledger: { enabled: false, directory: '' } } as ConfigService;
    return value;
};

const manager = (): { value: Cortex; context: Context; attention: Attention; scout: Scout; outputs: CollectiveOutput[] } => {
    const value = useContainer().create(Cortex);
    const context = useContainer().create(Context);
    context.config = config();
    const history = useContainer().create(History);
    history.config = config();
    history.inference = { completeText: async () => 'condensed digest' } as never;
    history.prompt = { section: () => 'compress' } as never;
    context.history = history;
    context.ledger = ledger();
    const attention = useContainer().create(Attention);
    attention.config = config();
    const scout = useContainer().create(Scout);
    scout.config = config();
    value.config = config();
    value.context = context;
    value.attention = attention;
    value.scout = scout;
    value.ledger = ledger();
    const outputs: CollectiveOutput[] = [];
    value.on(CollectiveSignalType.Output, (signal) => { outputs.push(signal.data as CollectiveOutput); });
    return { value, context, attention, scout, outputs };
};

describe('Cortex', () => {
    test('runs fixed specialists in parallel, then gives the leader one unified voice', async () => {
        const { value, scout, attention, outputs } = manager();
        const order: string[] = [];
        scout.detect = async () => ({ disposition: 'focus', salience: 1, consultants: ['researcher', 'reviewer'] });
        value.agents.researcher = fakeAgent('researcher', async () => {
            order.push('researcher');
            return report('researcher', 'research report');
        });
        value.agents.reviewer = fakeAgent('reviewer', async () => {
            order.push('reviewer');
            return report('reviewer', 'review report');
        });
        value.agents.flyflor = fakeAgent('flyflor', async (input, control) => {
            order.push('flyflor');
            expect((input as { items: Array<{ content: string }> }).items.map((item) => item.content)).toEqual(expect.arrayContaining(['researcher evidence', 'reviewer evidence']));
            control.onChunk('unified answer');
            return report('flyflor', 'unified answer');
        });

        const receipt = await value.receive(stimulus('m1'));
        await value.whenIdle();

        expect(receipt.state).toBe('focused');
        expect(order).toEqual(['researcher', 'reviewer', 'flyflor']);
        expect(outputs.find((output) => output.action === 'agent')).toMatchObject({
            targets: ['connection-speaker-a'],
            data: { focusId: 'focus_1', revision: 1, chunk: 'unified answer' },
        });
        expect(outputs.filter((output) => output.action === 'agent')).toHaveLength(1);
        for (const output of outputs.filter((item) => item.action === 'attention')) {
            expect(output.data).not.toHaveProperty('focusId');
            expect(output.data).not.toHaveProperty('revision');
        }
    });

    test('feeds the leader verbatim history from earlier completed turns', async () => {
        const { value, scout, attention } = manager();
        scout.detect = async () => ({ disposition: 'focus', salience: 1, consultants: [] });
        const seen: unknown[] = [];
        value.agents.flyflor = fakeAgent('flyflor', async (input) => {
            seen.push((input as { history: unknown[] }).history);
            return report('flyflor', `answer-${seen.length}`);
        });

        await value.receive(stimulus('m1'));
        await value.whenIdle();
        await value.receive(stimulus('m2'));
        await value.whenIdle();

        expect(seen[0]).toEqual([]);
        expect(seen[1]).toEqual([expect.objectContaining({ focusId: 'focus_1', answer: 'answer-1' })]);
        expect((seen[1] as Array<{ messages: Array<{ text: string }> }>)[0]?.messages[0]?.text).toBe('m1');
    });

    test('degrades one specialist failure into an observation for the leader', async () => {
        const { value, scout, attention, outputs } = manager();
        scout.detect = async () => ({ disposition: 'focus', salience: 1, consultants: ['researcher'] });
        value.agents.researcher = fakeAgent('researcher', async () => { throw Error('research unavailable'); });
        value.agents.flyflor = fakeAgent('flyflor', async (input, control) => {
            expect((input as { items: Array<{ content: string }> }).items.map((item) => item.content)).toContain('Specialist failed: research unavailable');
            control.onChunk('leader fallback');
            return report('flyflor', 'leader fallback');
        });

        await value.receive(stimulus('m1'));
        await value.whenIdle();

        expect(outputs.find((output) => output.action === 'agent')).toMatchObject({
            targets: ['connection-speaker-a'],
            data: { chunk: 'leader fallback' },
        });
        expect(outputs.some((output) => output.action === 'error')).toBe(false);
    });

    test('releases attention after leader failure and continues with the queued focus', async () => {
        const { value, context, scout, attention, outputs } = manager();
        let releaseFailure!: () => void;
        const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
        let runs = 0;
        scout.detect = async (_incoming, active) => active
            ? { disposition: 'queue', salience: 0.5, consultants: [] }
            : { disposition: 'focus', salience: 1, consultants: [] };
        value.agents.flyflor = fakeAgent('flyflor', async (_input, control) => {
            runs += 1;
            if (runs === 1) {
                await failureGate;
                throw Error('leader unavailable');
            }
            control.onChunk('queue recovered');
            return report('flyflor', 'queue recovered');
        });

        await value.receive(stimulus('m1', 'speaker-a'));
        expect((await value.receive(stimulus('m2', 'speaker-b'))).state).toBe('queued');
        releaseFailure();
        await value.whenIdle();

        expect(outputs.find((output) => output.action === 'error')).toMatchObject({
            targets: ['connection-speaker-a'],
            data: { focusId: 'focus_1', revision: 1, message: 'leader unavailable' },
        });
        expect(outputs.find((output) => output.action === 'agent')).toMatchObject({
            targets: ['connection-speaker-b'],
            data: { focusId: 'focus_2', revision: 1, chunk: 'queue recovered' },
        });
        expect(context.snapshot()).toContainEqual(expect.objectContaining({ kind: 'open', content: 'leader unavailable' }));
        expect(context.active()).toBeUndefined();
    });

    test('is idempotent for a repeated message id and queues unrelated input', async () => {
        const { value, scout, attention, outputs } = manager();
        let release!: () => void;
        const blocker = new Promise<void>((resolve) => { release = resolve; });
        scout.detect = async (_stimulus, active) => active
            ? { disposition: 'queue', salience: 0.5, consultants: [] }
            : { disposition: 'focus', salience: 1, consultants: [] };
        value.agents.flyflor = fakeAgent('flyflor', async () => {
            await blocker;
            return report('flyflor', 'done');
        });

        const first = await value.receive(stimulus('m1'));
        const queued = await value.receive(stimulus('m2', 'speaker-b'));
        const duplicate = await value.receive({ ...stimulus('m1'), connectionId: 'connection-reconnected' });
        const queuedRetry = await value.receive({ ...stimulus('m2', 'speaker-b'), connectionId: 'connection-queued-reconnected' });
        const collision = await value.receive(stimulus('m1', 'speaker-b'));
        expect(queued.state).toBe('queued');
        expect(duplicate).toEqual(first);
        expect(queuedRetry).toEqual(queued);
        expect(collision.state).toBe('rejected');
        expect(() => value.cancel({ speakerId: 'speaker-a', focusId: 'focus_1' }, undefined, 'm1')).toThrow('messageId is already bound to another action');
        expect(value.context.targets('focus_1')).toContain('connection-reconnected');
        expect(attention.size()).toBe(1);

        release();
        await value.whenIdle();
        expect(attention.size()).toBe(0);
        expect(outputs.find((output) => output.action === 'event' && (output.data as { type?: string }).type === 'focus')).toMatchObject({
            targets: ['connection-queued-reconnected'],
            data: { type: 'focus', messageId: 'm2', focusId: 'focus_2', revision: 1 },
        });
    });

    test('activates a queued explicit reply chain as one shared focus', async () => {
        const { value, scout, attention, outputs } = manager();
        let release!: () => void;
        const blocker = new Promise<void>((resolve) => { release = resolve; });
        let runs = 0;
        scout.detect = async (_incoming, active) => active
            ? { disposition: 'queue', salience: 0.5, consultants: [] }
            : { disposition: 'focus', salience: 1, consultants: [] };
        value.agents.flyflor = fakeAgent('flyflor', async (_input, control) => {
            runs += 1;
            if (runs === 1) await blocker;
            control.onChunk(`answer-${runs}`);
            return report('flyflor', `answer-${runs}`);
        });

        await value.receive(stimulus('active', 'speaker-a'));
        expect((await value.receive(stimulus('m1', 'speaker-b'))).state).toBe('queued');
        expect((await value.receive(stimulus('m2', 'speaker-c', 'm1'))).state).toBe('queued');
        release();
        await value.whenIdle();

        const activations = outputs.filter((output) => output.action === 'event' && (output.data as { type?: string }).type === 'focus');
        expect(activations).toEqual(expect.arrayContaining([
            expect.objectContaining({ targets: ['connection-speaker-b'], data: { type: 'focus', messageId: 'm1', focusId: 'focus_2', revision: 2 } }),
            expect.objectContaining({ targets: ['connection-speaker-c'], data: { type: 'focus', messageId: 'm2', focusId: 'focus_2', revision: 2 } }),
        ]));
        expect(outputs.find((output) => output.action === 'agent' && (output.data as { focusId?: string }).focusId === 'focus_2')).toMatchObject({
            targets: ['connection-speaker-b', 'connection-speaker-c'],
            data: { focusId: 'focus_2', revision: 2, chunk: 'answer-2' },
        });
    });

    test('keeps only an irreversible payload fingerprint for user idempotency', async () => {
        const { value, scout, attention } = manager();
        const rawText = 'private raw dialogue that must be released';
        scout.detect = async () => ({ disposition: 'focus', salience: 1, consultants: [] });
        value.agents.flyflor = fakeAgent('flyflor', async () => report('flyflor', 'semantic summary'));

        await value.receive({ ...stimulus('m1'), text: rawText });
        await value.whenIdle();
        const receipts = (value as unknown as { receipts: Map<string, unknown> }).receipts;

        expect(JSON.stringify([...receipts.values()])).not.toContain(rawText);
        expect(JSON.stringify([...receipts.values()])).toMatch(/[a-f0-9]{64}/);
    });

    test('serializes simultaneous intake so only one message observes an idle workspace', async () => {
        const { value, scout, attention } = manager();
        let releaseDecision!: () => void;
        let releaseLeader!: () => void;
        const decisionGate = new Promise<void>((resolve) => { releaseDecision = resolve; });
        const leaderGate = new Promise<void>((resolve) => { releaseLeader = resolve; });
        let decisions = 0;
        scout.detect = async (_stimulus, active) => {
            decisions += 1;
            if (decisions === 1) await decisionGate;
            return active
                ? { disposition: 'queue', salience: 0.5, consultants: [] }
                : { disposition: 'focus', salience: 1, consultants: [] };
        };
        value.agents.flyflor = fakeAgent('flyflor', async () => {
            await leaderGate;
            return report('flyflor', 'done');
        });

        const first = value.receive(stimulus('m1', 'speaker-a'));
        const second = value.receive(stimulus('m2', 'speaker-b'));
        releaseDecision();
        const receipts = await Promise.all([first, second]);

        expect(receipts.map((receipt) => receipt.state)).toEqual(['focused', 'queued']);
        releaseLeader();
        await value.whenIdle();
    });

    test('reserves a user message id while attention classification is pending', async () => {
        const { value, scout, attention } = manager();
        let releaseDecision!: () => void;
        let markDecisionStarted!: () => void;
        const decisionGate = new Promise<void>((resolve) => { releaseDecision = resolve; });
        const decisionStarted = new Promise<void>((resolve) => { markDecisionStarted = resolve; });
        scout.detect = async () => {
            markDecisionStarted();
            await decisionGate;
            return { disposition: 'focus', salience: 1, consultants: [] };
        };
        value.agents.flyflor = fakeAgent('flyflor', async () => report('flyflor', 'done'));

        const incoming = value.receive(stimulus('m1'));
        await decisionStarted;
        expect(() => value.cancel({ speakerId: 'speaker-a', focusId: 'focus_1' }, undefined, 'm1')).toThrow('messageId is already bound to another action');

        releaseDecision();
        expect((await incoming).state).toBe('focused');
        await value.whenIdle();
    });

    test('re-evaluates attention when the active focus completes during classification', async () => {
        const { value, scout, attention } = manager();
        let releaseLeader!: () => void;
        let releaseAttention!: () => void;
        let attentionStarted!: () => void;
        const leaderGate = new Promise<void>((resolve) => { releaseLeader = resolve; });
        const attentionGate = new Promise<void>((resolve) => { releaseAttention = resolve; });
        const started = new Promise<void>((resolve) => { attentionStarted = resolve; });
        let delayed = false;
        let runs = 0;
        scout.detect = async (incoming, active) => {
            if (incoming.messageId === 'm2' && active && !delayed) {
                delayed = true;
                attentionStarted();
                await attentionGate;
                return { disposition: 'merge', salience: 1, consultants: [] };
            }
            return active
                ? { disposition: 'queue', salience: 0.5, consultants: [] }
                : { disposition: 'focus', salience: 1, consultants: [] };
        };
        value.agents.flyflor = fakeAgent('flyflor', async () => {
            runs += 1;
            if (runs === 1) await leaderGate;
            return report('flyflor', 'done');
        });

        await value.receive(stimulus('m1'));
        const second = value.receive(stimulus('m2', 'speaker-b'));
        await started;
        releaseLeader();
        for (let attempt = 0; attempt < 100 && value.context.active(); attempt += 1) await Bun.sleep(1);
        releaseAttention();

        expect((await second).state).toBe('focused');
        await value.whenIdle();
    });

    test('merges a second speaker into the focus and resets the obsolete revision', async () => {
        const { value, scout, attention, outputs } = manager();
        let started!: () => void;
        const firstStarted = new Promise<void>((resolve) => { started = resolve; });
        let calls = 0;
        scout.detect = async (_stimulus, active) => active
            ? { disposition: 'merge', salience: 1, consultants: [] }
            : { disposition: 'focus', salience: 1, consultants: [] };
        value.agents.flyflor = fakeAgent('flyflor', async (_input, control) => {
            calls += 1;
            if (calls === 1) {
                started();
                return await new Promise<AgentReport>((_resolve, reject) => {
                    control.signal.addEventListener('abort', () => reject(control.signal.reason));
                });
            }
            control.onChunk('revised answer');
            return report('flyflor', 'revised answer');
        });

        await value.receive(stimulus('m1', 'speaker-a'));
        await firstStarted;
        const merged = await value.receive(stimulus('m2', 'speaker-b', 'm1'));
        await value.whenIdle();

        expect(merged).toMatchObject({ state: 'merged', focusId: 'focus_1', revision: 2 });
        expect(outputs.find((output) => output.action === 'responseReset')).toMatchObject({
            targets: ['connection-speaker-a', 'connection-speaker-b'],
            data: { focusId: 'focus_1', revision: 2 },
        });
        expect(outputs.find((output) => output.action === 'agent')).toMatchObject({
            targets: ['connection-speaker-a', 'connection-speaker-b'],
            data: { focusId: 'focus_1', revision: 2, chunk: 'revised answer' },
        });
    });

    test('keeps one consciousness across merge, queue, revision reset, and reconnect', async () => {
        const { value, context, scout, attention, outputs } = manager();
        let markFirstStarted!: () => void;
        let markRevisedStarted!: () => void;
        let releaseRevised!: () => void;
        const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
        const revisedStarted = new Promise<void>((resolve) => { markRevisedStarted = resolve; });
        const revisedGate = new Promise<void>((resolve) => { releaseRevised = resolve; });
        scout.detect = async (incoming, active) => {
            if (!active) return { disposition: 'focus', salience: 1, consultants: [] };
            if (incoming.messageId === 'm2') return { disposition: 'merge', salience: 1, consultants: [] };
            return { disposition: 'queue', salience: 0.5, consultants: [] };
        };
        let runs = 0;
        value.agents.flyflor = fakeAgent('flyflor', async (_input, control) => {
            runs += 1;
            if (runs === 1) {
                markFirstStarted();
                return await new Promise<AgentReport>((_resolve, reject) => {
                    control.signal.addEventListener('abort', () => reject(control.signal.reason), { once: true });
                });
            }
            if (runs === 2) {
                markRevisedStarted();
                await revisedGate;
                control.onChunk('shared merged answer');
                return report('flyflor', 'shared merged answer');
            }
            control.onChunk('queued answer');
            return report('flyflor', 'queued answer');
        });

        const original = await value.receive(stimulus('m1', 'speaker-a'));
        await firstStarted;
        const merged = await value.receive(stimulus('m2', 'speaker-b', 'm1'));
        await revisedStarted;
        const queued = await value.receive(stimulus('m3', 'speaker-c'));
        value.disconnect('connection-speaker-a');
        const reconnected = await value.receive({ ...stimulus('m1', 'speaker-a'), connectionId: 'connection-speaker-a-new' });
        releaseRevised();
        await value.whenIdle();

        expect(original.state).toBe('focused');
        expect(merged).toMatchObject({ state: 'merged', focusId: 'focus_1', revision: 2 });
        expect(queued.state).toBe('queued');
        expect(reconnected).toEqual(original);
        expect(outputs.find((output) => output.action === 'responseReset')).toMatchObject({
            targets: ['connection-speaker-a', 'connection-speaker-b'],
            data: { focusId: 'focus_1', revision: 2 },
        });
        expect(outputs.find((output) => output.action === 'agent' && (output.data as { chunk?: string }).chunk === 'shared merged answer')).toMatchObject({
            targets: ['connection-speaker-a-new', 'connection-speaker-b'],
            data: { focusId: 'focus_1', revision: 2 },
        });
        expect(outputs.find((output) => output.action === 'agent' && (output.data as { chunk?: string }).chunk === 'queued answer')).toMatchObject({
            targets: ['connection-speaker-c'],
            data: { focusId: 'focus_2', revision: 1 },
        });
        expect(context.active()).toBeUndefined();
        expect(runs).toBe(3);
    });

    test('holds a hard interaction gate for the owner while ordinary input queues', async () => {
        const { value, context, scout, attention, outputs } = manager();
        let runs = 0;
        scout.detect = async (_stimulus, active) => active?.state === 'waiting'
            ? { disposition: 'queue', salience: 0.5, consultants: [] }
            : { disposition: 'focus', salience: 1, consultants: [] };
        value.agents.flyflor = fakeAgent('flyflor', async (input) => {
            runs += 1;
            const current = input as { focus: { id: string; revision: number } };
            if (runs > 1) return report('flyflor', 'queued answer');
            const response = await value.interact({
                focusId: current.focus.id,
                revision: current.focus.revision,
                requestId: 'confirm_1',
                agentId: 'flyflor',
                kind: 'confirm',
                data: { question: 'Proceed?' },
            });
            return report('flyflor', response.kind === 'confirm' && response.approved ? 'approved' : 'rejected');
        });

        await value.receive(stimulus('m1', 'speaker-a'));
        for (let attempt = 0; attempt < 100 && !outputs.some((output) => output.action === 'confirm'); attempt += 1) await Bun.sleep(1);
        const prompt = outputs.find((output) => output.action === 'confirm');
        expect(prompt).toMatchObject({ targets: ['connection-speaker-a'], data: { requestId: 'confirm_1' } });
        expect((await value.receive(stimulus('m2', 'speaker-b'))).state).toBe('queued');
        expect(() => value.answer({ speakerId: 'speaker-b', focusId: 'focus_1', requestId: 'confirm_1', response: { kind: 'confirm', approved: true } })).toThrow('Only the focus owner');

        const confirmation = { speakerId: 'speaker-a', focusId: 'focus_1', requestId: 'confirm_1', response: { kind: 'confirm' as const, approved: true } };
        const answerReceipt = value.answer(confirmation, 'connection-reconnected', 'answer-1');
        const answerRetry = value.answer(confirmation, 'connection-retry', 'answer-1');
        expect(answerRetry).toEqual(answerReceipt);
        expect(answerReceipt).toEqual({ messageId: 'answer-1', action: 'answer', state: 'accepted' });
        expect(() => value.answer({ ...confirmation, response: { kind: 'confirm', approved: false } }, undefined, 'answer-1')).toThrow('messageId is already bound to another payload');
        expect(context.snapshot()).toContainEqual(expect.objectContaining({
            kind: 'constraint',
            content: 'Tool confirmation approved',
            sourceMessageIds: ['answer-1'],
            speakerIds: ['speaker-a'],
        }));
        await value.whenIdle();
        expect(outputs.find((output) => output.action === 'streamEnd')).toMatchObject({
            targets: ['connection-speaker-a', 'connection-reconnected', 'connection-retry'],
        });
    });

    test('rejects ask answers that do not match the pending questions', async () => {
        const { value, context } = manager();
        const focus = context.open(stimulus('m1'), []);
        const interaction = value.interact({
            focusId: focus.id,
            revision: focus.revision,
            requestId: 'ask-1',
            agentId: 'flyflor',
            kind: 'ask',
            data: { questions: [{ question: 'Target?', options: [] }, { question: 'Mode?', options: [] }] },
        });

        expect(() => value.answer({
            speakerId: 'speaker-a',
            focusId: focus.id,
            requestId: 'ask-1',
            response: { kind: 'ask', answers: [{ question: 'Injected?', answer: 'value' }] },
        }, undefined, 'bad-answer')).toThrow('Ask response does not match pending questions');
        value.answer({
            speakerId: 'speaker-a',
            focusId: focus.id,
            requestId: 'ask-1',
            response: {
                kind: 'ask',
                answers: [
                    { question: 'Target?', answer: 'IPC' },
                    { question: 'Mode?', answer: 'strict' },
                ],
            },
        }, undefined, 'good-answer');

        await expect(interaction).resolves.toEqual({
            kind: 'ask',
            answers: [
                { question: 'Target?', answer: 'IPC' },
                { question: 'Mode?', answer: 'strict' },
            ],
        });
        expect(context.active()?.constraints).toEqual(['Target?: IPC', 'Mode?: strict']);
    });

    test('makes cancellation idempotent and reserves command ids across actions', async () => {
        const { value, context, outputs } = manager();
        const focus = context.open(stimulus('m1'), []);
        const cancellation = { speakerId: 'speaker-a', focusId: focus.id };

        const cancelReceipt = value.cancel(cancellation, 'connection-reconnected', 'cancel-1');
        expect(outputs.find((output) => output.action === 'attention' && (output.data as { state?: string }).state === 'cancelled')).toMatchObject({
            data: { state: 'cancelled', busy: true },
        });
        expect(value.cancel(cancellation, 'connection-retry', 'cancel-1')).toEqual(cancelReceipt);
        expect(cancelReceipt).toEqual({ messageId: 'cancel-1', action: 'cancel', state: 'accepted' });
        expect(() => value.cancel({ ...cancellation, focusId: 'focus_other' }, undefined, 'cancel-1')).toThrow('messageId is already bound to another payload');
        expect(() => value.answer({
            speakerId: 'speaker-a',
            focusId: focus.id,
            requestId: 'confirm_1',
            response: { kind: 'confirm', approved: true },
        }, undefined, 'cancel-1')).toThrow('messageId is already bound to another payload');

        const collision = await value.receive(stimulus('cancel-1'));

        expect(collision.state).toBe('rejected');
        expect(outputs).toContainEqual(expect.objectContaining({
            action: 'error',
            data: { messageId: 'cancel-1', message: 'messageId is already bound to another action' },
        }));
    });

    test('records a completed action observation from an obsolete revision', () => {
        const { value, context } = manager();
        const focus = context.open(stimulus('m1'), []);
        context.merge(stimulus('m2', 'speaker-b', 'm1'), []);
        const forward = (value as unknown as { forwardAgentEvent: (event: unknown) => void }).forwardAgentEvent.bind(value);

        forward({
            agentId: 'flyflor',
            focusId: focus.id,
            revision: 1,
            type: 'action_result',
            data: { evidence: 'filesystem ok: path=/tmp/completed' },
        });

        expect(context.snapshot().map((item) => item.content)).toContain('filesystem ok: path=/tmp/completed');
    });

    test('keeps a cancelled focus until a started action observation is recorded', () => {
        const { value, context } = manager();
        const focus = context.open(stimulus('m1'), []);
        context.cancel(focus.id);
        const forward = (value as unknown as { forwardAgentEvent: (event: unknown) => void }).forwardAgentEvent.bind(value);

        forward({
            agentId: 'flyflor',
            focusId: focus.id,
            revision: 1,
            type: 'action_result',
            data: { evidence: 'shell ok: {"exitCode":0}' },
        });

        expect(context.active()?.state).toBe('cancelled');
        expect(context.snapshot().map((item) => item.content)).toContain('shell ok: {"exitCode":0}');
        context.releaseCancelled(focus.id);
        expect(context.active()).toBeUndefined();
    });

    test('broadcasts the scout spike as an observable cortical discharge', async () => {
        const { value, scout, outputs } = manager();
        await value.init();
        scout.detect = async () => ({ disposition: 'focus', salience: 1, consultants: [] });
        value.agents.flyflor = fakeAgent('flyflor', async () => report('flyflor', 'done'));

        await value.receive(stimulus('m1'));
        await value.whenIdle();

        expect(outputs).toContainEqual(expect.objectContaining({
            action: 'event',
            data: { type: 'spike', spike: { disposition: 'focus', salience: 1, consultants: [] } },
        }));
    });

    test('keeps the roster fixed and forces non-leaders to read scope', async () => {
        const first = await useContainer().getAsync(Cortex);
        const second = await useContainer().getAsync(Cortex);

        expect(second).toBe(first);
        expect(Object.keys(first.agents).sort()).toEqual(['flyflor', 'researcher', 'reviewer']);
        expect(first.agents.researcher?.agentConfig.actionScope).toBe('read');
        expect(first.agents.reviewer?.agentConfig.actionScope).toBe('read');
    });
});
