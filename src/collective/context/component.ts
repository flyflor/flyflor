import type { AgentInteractionResponse, AgentReport } from '@/agent/types';
import { AgentChatRole } from '@/agent/types';
import type { MemoryNote } from '@/agent/memory/types';
import { History, type DialogueTurn } from '@/collective/history';
import type { ConfigService } from '@/configuration';
import { Config, FComponent, Inject, Prompt, PromptService, Singleton } from '@/core';
import { Inference, Model } from '@/inference';
import { Ledger } from '@/ledger';
import type { AgentContext, AgentFocus, ContextItem, ContextItemKind, Focus, FocusParticipant, Stimulus } from './types';

const MAX_CONTEXT_ITEM_CHARS = 8000;
const MAX_COMPACT_INPUT_CHARS = 24000;
const MAX_COMPACT_BATCH_ITEMS = 32;
const DEFAULT_COMPRESS_ITEM_LIMIT = 96;

/**
 * EN: The process-wide global workspace. It is the only owner of conversational truth.
 * ZH: 进程级全局工作空间，也是对话事实的唯一所有者。
 */
@Singleton()
export class Context extends FComponent {
    @Config()
    public config!: ConfigService;

    @Inject()
    public history!: History;

    @Inject()
    public ledger!: Ledger;

    @Model()
    public inference!: Inference;

    @Prompt('prompts/context')
    public prompt!: PromptService;

    private sequence = 0;
    private itemSequence = 0;
    private current?: Focus;
    private readonly items: ContextItem[] = [];
    private readonly messages = new Set<string>();
    private compacting?: Promise<void>;

    public hasMessage(messageId: string): boolean {
        return this.messages.has(messageId);
    }

    public reconnect(stimulus: Stimulus): void {
        const focus = this.current;
        const source = focus?.stimuli.find((item) => item.messageId === stimulus.messageId && item.speakerId === stimulus.speakerId);
        if (focus && source) this.attachParticipant(focus, stimulus);
    }

    public connect(focusId: string, speakerId: string, connectionId: string): void {
        const focus = this.requireFocus(focusId);
        const participant = focus.participants.find((item) => item.speakerId === speakerId);
        if (!participant) throw Error('Speaker is not a focus participant');
        if (!participant.connectionIds.includes(connectionId)) participant.connectionIds.push(connectionId);
    }

    public disconnect(connectionId: string): void {
        const focus = this.current;
        if (!focus) return;
        for (const participant of focus.participants) {
            participant.connectionIds = participant.connectionIds.filter((id) => id !== connectionId);
        }
    }

    public active(): Focus | undefined {
        return this.current === undefined ? undefined : structuredClone(this.current);
    }

    public open(stimulus: Stimulus, consultants: string[]): Focus {
        if (this.current !== undefined) throw Error('A focus is already active');
        this.rememberMessage(stimulus.messageId);
        this.sequence += 1;
        const now = Date.now();
        this.current = {
            id: `focus_${this.sequence}`,
            revision: 1,
            ownerSpeakerId: stimulus.speakerId,
            state: 'working',
            stimuli: [structuredClone(stimulus)],
            participants: [{ speakerId: stimulus.speakerId, connectionIds: [stimulus.connectionId] }],
            consultants: [...consultants],
            goal: stimulus.text,
            constraints: [],
            references: stimulus.replyTo ? [stimulus.replyTo] : [],
            createdAt: now,
            updatedAt: now,
        };
        return structuredClone(this.current);
    }

    public merge(stimulus: Stimulus, consultants: string[]): Focus {
        const focus = this.requireActive();
        if (focus.state !== 'working') throw Error('A waiting focus cannot be merged');
        this.rememberMessage(stimulus.messageId);
        focus.stimuli.push(structuredClone(stimulus));
        this.attachParticipant(focus, stimulus);
        focus.consultants = [...new Set([...focus.consultants, ...consultants])];
        focus.goal = focus.stimuli.map((item) => item.text).join('\n');
        if (stimulus.replyTo) focus.references = [...new Set([...focus.references, stimulus.replyTo])];
        focus.revision += 1;
        focus.updatedAt = Date.now();
        return structuredClone(focus);
    }

    public wait(focusId: string): void {
        const focus = this.requireFocus(focusId);
        if (focus.state !== 'working') throw Error(`Focus is not working: ${focusId}`);
        focus.state = 'waiting';
        focus.updatedAt = Date.now();
    }

    public resume(focusId: string): void {
        const focus = this.requireFocus(focusId);
        if (focus.state !== 'waiting') throw Error(`Focus is not waiting: ${focusId}`);
        focus.state = 'working';
        focus.updatedAt = Date.now();
    }

    public cancel(focusId: string): Focus {
        const focus = this.requireFocus(focusId);
        focus.state = 'cancelled';
        focus.updatedAt = Date.now();
        return structuredClone(focus);
    }

    public releaseCancelled(focusId: string): Focus {
        const focus = this.requireFocus(focusId);
        if (focus.state !== 'cancelled') throw Error(`Focus is not cancelled: ${focusId}`);
        return this.release(focus);
    }

    public observe(focusId: string, report: AgentReport): void {
        const focus = this.requireFocus(focusId);
        this.absorb(focus, report, true);
        this.trim();
    }

    public observeAction(focusId: string, agentId: string, evidence: string): void {
        const focus = this.requireFocus(focusId);
        this.add(
            'fact',
            evidence,
            focus,
            agentId,
            0.95,
            focus.stimuli.map((item) => item.messageId),
            focus.participants.map((item) => item.speakerId),
        );
        this.trim();
    }

    public observeInteraction(focusId: string, speakerId: string, messageId: string, response: AgentInteractionResponse): void {
        const focus = this.requireFocus(focusId);
        if (response.kind === 'ask') {
            for (const answer of response.answers) {
                const constraint = `${answer.question}: ${answer.answer}`;
                if (!focus.constraints.includes(constraint)) focus.constraints.push(constraint);
                this.add('constraint', constraint, focus, undefined, 1, [messageId], [speakerId]);
            }
            focus.updatedAt = Date.now();
        } else {
            this.add('constraint', `Tool confirmation ${response.approved ? 'approved' : 'rejected'}`, focus, undefined, 1, [messageId], [speakerId]);
        }
        this.trim();
    }

    public async complete(focusId: string, report: AgentReport): Promise<Focus> {
        const focus = this.requireFocus(focusId);
        this.absorb(focus, report, false);
        this.add(
            'fact',
            report.answer,
            focus,
            report.agentId,
            0.85,
            focus.stimuli.map((item) => item.messageId),
            focus.participants.map((item) => item.speakerId),
        );
        focus.state = 'completed';
        focus.updatedAt = Date.now();
        this.trim();
        this.ledger.recordTurn(focus, report);
        await this.history.record(focus, report);
        return this.release(focus);
    }

    public forAgent(agentId: string, localMemory: MemoryNote[], capacityChars = this.config.collective.contextCharLimit): AgentContext {
        const focus = this.requireActive();
        const limit = Math.max(0, Math.min(capacityChars, this.config.collective.contextCharLimit));
        const agentFocus = this.fitFocus(focus, limit);
        const baseChars = JSON.stringify({ focus: agentFocus, history: [], globalWorkspace: [], localMemory: [] }).length;
        const historyBudget = Math.min(Math.floor(limit * this.historyShare()), Math.max(0, limit - baseChars));
        const history = this.history.recent(historyBudget);
        const selected = this.select(focus, agentFocus, history, localMemory, limit);
        return {
            agentId,
            focus: agentFocus,
            history,
            items: structuredClone(selected.items),
            localMemory: structuredClone(selected.localMemory),
        };
    }

    public targets(focusId?: string): string[] {
        const focus = focusId === undefined ? this.requireActive() : this.requireFocus(focusId);
        return [...new Set(focus.participants.flatMap((participant) => participant.connectionIds))];
    }

    public ownerTargets(focusId: string): string[] {
        const focus = this.requireFocus(focusId);
        return [...(focus.participants.find((participant) => participant.speakerId === focus.ownerSpeakerId)?.connectionIds ?? [])];
    }

    public snapshot(): ContextItem[] {
        return structuredClone(this.items);
    }

    private attachParticipant(focus: Focus, stimulus: Stimulus): void {
        let participant = focus.participants.find((item) => item.speakerId === stimulus.speakerId);
        if (!participant) {
            participant = { speakerId: stimulus.speakerId, connectionIds: [] };
            focus.participants.push(participant);
        }
        if (!participant.connectionIds.includes(stimulus.connectionId)) participant.connectionIds.push(stimulus.connectionId);
    }

    private select(focus: Focus, agentFocus: AgentFocus, history: DialogueTurn[], localMemory: MemoryNote[], limit: number): { items: ContextItem[]; localMemory: MemoryNote[] } {
        const terms = new Set(focus.goal.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length > 1));
        const ranked = [...this.items].sort((left, right) => this.rank(right, terms) - this.rank(left, terms));
        const items: ContextItem[] = [];
        let chars = JSON.stringify({ focus: agentFocus, history, globalWorkspace: [], localMemory: [] }).length;
        for (const item of ranked) {
            const size = JSON.stringify(item).length + 1;
            if (chars + size > limit) continue;
            item.lastAccessedAt = Date.now();
            items.push(item);
            chars += size;
        }
        const notes: MemoryNote[] = [];
        for (const note of [...localMemory].sort((left, right) => right.salience - left.salience || right.lastAccessedAt - left.lastAccessedAt)) {
            const size = JSON.stringify(note).length + 1;
            if (chars + size > limit) continue;
            notes.push(note);
            chars += size;
        }
        return { items, localMemory: notes };
    }

    private fitFocus(focus: Focus, limit: number): AgentFocus {
        const projected: AgentFocus = {
            id: focus.id,
            revision: focus.revision,
            ownerSpeakerId: focus.ownerSpeakerId,
            messages: focus.stimuli.map(({ messageId, speakerId, text, replyTo }) => ({ messageId, speakerId, text, replyTo })),
            goal: focus.goal,
            constraints: [...focus.constraints],
            references: [...focus.references],
        };
        if (projected.messages.length > 64) projected.messages = [projected.messages[0]!, ...projected.messages.slice(-63)];
        if (projected.constraints.length > 64) projected.constraints = [projected.constraints[0]!, ...projected.constraints.slice(-63)];
        if (projected.references.length > 64) projected.references = projected.references.slice(-64);
        while (true) {
            const size = JSON.stringify(projected).length;
            if (size <= limit) break;
            const excess = size - limit;
            if (this.shortenFocusText(projected, excess)) continue;
            if (projected.messages.length > 2) {
                projected.messages.splice(1, 1);
                continue;
            }
            if (projected.constraints.length > 2) {
                projected.constraints.splice(1, 1);
                continue;
            }
            if (projected.references.length > 1) {
                projected.references.shift();
                continue;
            }
            break;
        }
        return projected;
    }

    private shortenFocusText(focus: AgentFocus, excess: number): boolean {
        let kind: 'goal' | 'message' | 'constraint' | undefined;
        let index = -1;
        let value = focus.goal;
        if (value.length > 64) kind = 'goal';
        for (let position = 0; position < focus.messages.length; position += 1) {
            const candidate = focus.messages[position]!.text;
            if (candidate.length > Math.max(64, value.length)) {
                kind = 'message';
                index = position;
                value = candidate;
            }
        }
        for (let position = 0; position < focus.constraints.length; position += 1) {
            const candidate = focus.constraints[position]!;
            if (candidate.length > Math.max(64, value.length)) {
                kind = 'constraint';
                index = position;
                value = candidate;
            }
        }
        if (!kind || value.length <= 64) return false;
        const target = Math.max(64, value.length - Math.max(excess, Math.ceil(value.length / 4)));
        const shortened = `${value.slice(0, target - 3)}...`;
        if (kind === 'goal') focus.goal = shortened;
        else if (kind === 'message') focus.messages[index]!.text = shortened;
        else focus.constraints[index] = shortened;
        return true;
    }

    private absorb(focus: Focus, report: AgentReport, includeAnswer: boolean): void {
        const source = focus.stimuli.map((item) => item.messageId);
        const speakers = focus.participants.map((item) => item.speakerId);
        if (includeAnswer && report.answer.trim()) this.add('fact', report.answer, focus, report.agentId, 0.72, source, speakers);
        for (const content of report.evidence) this.add('fact', content, focus, report.agentId, 0.9, source, speakers);
        for (const content of report.remaining) this.add('open', content, focus, report.agentId, 1, source, speakers);
    }

    private rank(item: ContextItem, terms: Set<string>): number {
        const content = item.content.toLowerCase();
        let overlap = 0;
        for (const term of terms) if (content.includes(term)) overlap += 1;
        const recency = 1 / Math.max(1, (Date.now() - item.lastAccessedAt) / 60000);
        const protectedKind = item.kind === 'constraint' || item.kind === 'open' ? 2 : 0;
        return item.salience * 4 + overlap + recency + protectedKind;
    }

    private historyShare(): number {
        return Math.max(0, Math.min(1, this.config.collective.historyShare));
    }

    private add(
        kind: ContextItemKind,
        content: string,
        focus: Focus,
        agentId: string | undefined,
        salience: number,
        sourceMessageIds: string[],
        speakerIds: string[],
    ): void {
        const source = content.trim();
        if (!source) return;
        const normalized = source.length <= MAX_CONTEXT_ITEM_CHARS
            ? source
            : `${source.slice(0, MAX_CONTEXT_ITEM_CHARS - 3)}...`;
        this.itemSequence += 1;
        const now = Date.now();
        this.items.push({
            id: `context_${this.itemSequence}`,
            kind,
            content: normalized,
            sourceFocusId: focus.id,
            sourceMessageIds: [...sourceMessageIds],
            speakerIds: [...speakerIds],
            agentId,
            salience,
            createdAt: now,
            lastAccessedAt: now,
        });
    }

    private trim(): void {
        const limit = Math.max(0, this.config.collective.contextItemLimit);
        while (this.items.length > limit) {
            const records = this.items
                .map((item, index) => ({ item, index }))
            const ordinary = records.filter(({ item }) => !this.protected(item));
            const emergency = records.filter(({ item }) => !this.pinned(item));
            const candidates = (ordinary.length > 0 ? ordinary : emergency.length > 0 ? emergency : records)
                .sort((left, right) => left.item.salience - right.item.salience || left.item.lastAccessedAt - right.item.lastAccessedAt);
            const index = candidates[0]!.index;
            this.items.splice(index, 1);
        }
        this.scheduleCompact();
    }

    /**
     * EN: Starts one background compaction pass when ordinary items exceed the soft threshold.
     * It never blocks the conversation: one guarded promise runs at a time, and a failure only
     * logs a warning before the next pass is considered.
     * ZH: 普通条目超过软阈值时启动一轮后台压缩。绝不阻塞对话:同一时刻只跑一个受保护的 promise,
     * 失败只记警告,随后继续评估下一轮。
     */
    private scheduleCompact(): void {
        if (this.compacting || !this.needsCompact()) return;
        this.compacting = this.compact()
            .catch((error) => {
                this.log.warn('context.compressFailed', { error: error instanceof Error ? error.message : String(error) });
            })
            .finally(() => {
                this.compacting = undefined;
                this.scheduleCompact();
            });
    }

    /**
     * EN: Waits until every pending or chained background compaction pass settles.
     * ZH: 等待所有挂起或链式触发的后台压缩轮次全部结束。
     */
    public async whenCompact(): Promise<void> {
        while (this.compacting) await this.compacting;
    }

    /**
     * EN: Folds the lowest-value ordinary batches into digest items until the workspace is back
     * under the soft threshold or no eligible batch remains. Protected kinds and reference-pinned
     * items never enter a batch; the hard item cap and emergency eviction stay as the final backstop.
     * ZH: 把价值最低的普通条目批折叠成 digest 条目,直到工作空间回到软阈值以下或没有可压缩批次。
     * 受保护类型和被引用钉住的条目永不进入批次;硬上限与紧急淘汰仍是最后防线。
     */
    private async compact(): Promise<void> {
        while (this.items.length > this.softLimit()) {
            const batch = this.batch();
            if (batch.length < 2) return;
            const digest = await this.digestOf(batch);
            const folded = new Set(batch.map((item) => item.id));
            const remaining = this.items.filter((item) => !folded.has(item.id));
            this.items.splice(0, this.items.length, ...remaining, digest);
        }
    }

    /**
     * EN: Effective soft threshold: the configured compress limit, never above the hard cap.
     * ZH: 生效的软阈值:取配置的压缩上限,且绝不高于硬上限。
     */
    private softLimit(): number {
        const hard = Math.max(0, this.config.collective.contextItemLimit);
        const configured = this.config.collective.contextCompressItemLimit;
        const soft = typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
            ? Math.floor(configured)
            : DEFAULT_COMPRESS_ITEM_LIMIT;
        return Math.min(soft, Math.max(2, hard - 2));
    }

    private needsCompact(): boolean {
        return this.items.length > this.softLimit() && this.batch().length >= 2;
    }

    /**
     * EN: Selects the next fold batch: the lowest-salience, least-recently-accessed ordinary items,
     * enough to return to the soft threshold, bounded by batch size and input character caps.
     * ZH: 选择下一批折叠对象:显著性最低、访问最旧的普通条目,数量足以回到软阈值,
     * 同时受批次条数与输入字符上限约束。
     */
    private batch(): ContextItem[] {
        const eligible = this.items.filter((item) => !this.protected(item));
        if (eligible.length < 2) return [];
        const excess = this.items.length - this.softLimit();
        const ranked = [...eligible].sort((left, right) => (
            left.salience - right.salience || left.lastAccessedAt - right.lastAccessedAt
        ));
        const batch: ContextItem[] = [];
        let chars = 0;
        for (const item of ranked) {
            const size = item.content.length;
            if (batch.length >= 2 && chars + size > MAX_COMPACT_INPUT_CHARS) break;
            batch.push(item);
            chars += size;
            if (batch.length >= Math.max(2, excess + 1)) break;
            if (batch.length >= MAX_COMPACT_BATCH_ITEMS) break;
        }
        return batch;
    }

    /**
     * EN: Builds one digest item that replaces the folded batch. It keeps the union of source
     * metadata, the highest source salience, and the earliest source timestamp so ranking stays honest.
     * ZH: 构造一个替代折叠批次的 digest 条目。保留来源元数据并集、最高来源显著性
     * 与最早来源时间戳,让排序保持诚实。
     */
    private async digestOf(batch: ContextItem[]): Promise<ContextItem> {
        const sourceChars = batch.reduce((chars, item) => chars + item.content.length + 1, 0);
        const targetChars = Math.min(Math.floor(sourceChars / 2), MAX_CONTEXT_ITEM_CHARS);
        const content = this.bounded(await this.compressBatch(batch, targetChars), MAX_CONTEXT_ITEM_CHARS);
        this.itemSequence += 1;
        return {
            id: `context_${this.itemSequence}`,
            kind: 'digest',
            content,
            sourceFocusId: batch.reduce((earliest, item) => item.createdAt < earliest.createdAt ? item : earliest).sourceFocusId,
            sourceMessageIds: [...new Set(batch.flatMap((item) => item.sourceMessageIds))],
            speakerIds: [...new Set(batch.flatMap((item) => item.speakerIds))],
            agentId: undefined,
            salience: Math.max(...batch.map((item) => item.salience)),
            createdAt: Math.min(...batch.map((item) => item.createdAt)),
            lastAccessedAt: Date.now(),
        };
    }

    /**
     * EN: Compresses one batch with the model and falls back to a deterministic merge when the
     * model is unavailable or returns nothing usable. Digest items inside the batch are condensed
     * older content and must be carried forward without loss.
     * ZH: 用模型压缩一个批次;模型不可用或返回空内容时回退到确定性合并。批次中的 digest
     * 条目是更早内容的浓缩,必须原样保留信息。
     */
    private async compressBatch(batch: ContextItem[], targetChars: number): Promise<string> {
        try {
            const result = await this.inference.completeText([
                { role: AgentChatRole.System, content: this.prompt.section('COMPACT') },
                {
                    role: AgentChatRole.User,
                    content: JSON.stringify({
                        targetChars,
                        items: batch.map((item) => ({ id: item.id, kind: item.kind, content: item.content })),
                    }),
                },
            ]);
            const trimmed = result.trim();
            return trimmed || this.mergeFallback(batch, targetChars);
        } catch (error) {
            this.log.warn('context.compressFallback', { error: error instanceof Error ? error.message : String(error) });
            return this.mergeFallback(batch, targetChars);
        }
    }

    /**
     * EN: Deterministic merge fallback: joins the batch verbatim with kind tags, then keeps the
     * head and tail around an explicit truncation marker.
     * ZH: 确定性合并回退:带类型标签逐字拼接批次,截断时在显式标记两侧保留首尾。
     */
    private mergeFallback(batch: ContextItem[], targetChars: number): string {
        const merged = batch.map((item) => `[${item.kind}] ${item.content}`).join('\n\n');
        return this.bounded(merged, targetChars);
    }

    private bounded(text: string, limit: number): string {
        if (text.length <= limit) return text;
        const marker = '\n...[context digest truncated]...\n';
        const edge = Math.floor((limit - marker.length) / 2);
        return `${text.slice(0, edge)}${marker}${text.slice(-edge)}`;
    }

    private protected(item: ContextItem): boolean {
        if (item.kind === 'constraint' || item.kind === 'open') return true;
        const references = this.current?.references ?? [];
        return references.some((reference) => (
            reference === item.id
            || reference === item.sourceFocusId
            || item.sourceMessageIds.includes(reference)
        ));
    }

    private pinned(item: ContextItem): boolean {
        const focus = this.current;
        if (!focus) return false;
        if (item.sourceFocusId === focus.id && (item.kind === 'constraint' || item.kind === 'open')) return true;
        return focus.references.some((reference) => (
            reference === item.id
            || reference === item.sourceFocusId
            || item.sourceMessageIds.includes(reference)
        ));
    }

    private release(focus: Focus): Focus {
        const released = structuredClone(focus);
        this.current = undefined;
        return released;
    }

    private rememberMessage(messageId: string): void {
        if (this.messages.has(messageId)) throw Error(`Duplicate message: ${messageId}`);
        this.messages.add(messageId);
    }

    private requireActive(): Focus {
        if (!this.current) throw Error('No active focus');
        return this.current;
    }

    private requireFocus(focusId: string): Focus {
        const focus = this.requireActive();
        if (focus.id !== focusId) throw Error(`Focus does not match: ${focusId}`);
        return focus;
    }
}
